import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { timelineDocSchema, propsDocSchema, projectDocSchema, eventEnvelopeSchema, globalSettingsSchema } from '@shared/schema';
import timelineFixture from '../../src/shared/schema/__fixtures__/timeline.sample.json';
import propsFixture from '../../src/shared/schema/__fixtures__/props.sample.json';

const fixture = () => structuredClone(timelineFixture);
describe('timeline schema', () => {
  it('parses the sample timeline', () => { expect(timelineDocSchema.parse(fixture()).tracks).toHaveLength(8); });
  it.each([
    ['unknown item type', (doc: ReturnType<typeof fixture>) => { const item = doc.tracks[3]?.items[0]; if (item) item.type = 'unknown'; }],
    ['negative duration', (doc: ReturnType<typeof fixture>) => { const item = doc.tracks[3]?.items[0]; if (item) item.duration = -1; }],
    ['malformed id', (doc: ReturnType<typeof fixture>) => { const item = doc.tracks[3]?.items[0]; if (item) item.id = 'clip_bad'; }],
    ['seven tracks', (doc: ReturnType<typeof fixture>) => { doc.tracks.pop(); }],
    ['wrong order', (doc: ReturnType<typeof fixture>) => { doc.tracks.reverse(); }],
  ])('rejects %s', (_name, mutate) => { const doc = fixture(); mutate(doc); expect(timelineDocSchema.safeParse(doc).success).toBe(false); });
  it('rejects unsafe source paths', () => {
    const doc = fixture(); const item = doc.tracks[3]?.items[0]; if (item && 'src' in item) item.src = 'raw/%2e%2e/private';
    expect(timelineDocSchema.safeParse(doc).success).toBe(false);
  });
});
describe('editable props', () => {
  it('parses text, color and number bindings', () => { expect(propsDocSchema.parse(propsFixture).elements).toHaveLength(1); });
  it('rejects unknown binding forms', () => {
    const doc = structuredClone(propsFixture); const element = doc.elements[0]; if (element) element.props.text.bind = 'onclick';
    expect(propsDocSchema.safeParse(doc).success).toBe(false);
  });
});
describe('generated JSON schemas', () => {
  it.each([['timeline', timelineDocSchema], ['props', propsDocSchema], ['project', projectDocSchema], ['events', eventEnvelopeSchema], ['settings', globalSettingsSchema]] as const)('%s is valid draft-07', (_name, schema) => {
    const generated = zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' });
    const ajv = new Ajv({ strict: false });
    expect(ajv.validateSchema(generated)).toBe(true);
  });
  it('validates the fixture using the generated timeline schema', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(zodToJsonSchema(timelineDocSchema, { target: 'jsonSchema7', $refStrategy: 'none' }));
    expect(validate(timelineFixture)).toBe(true);
  });
});
