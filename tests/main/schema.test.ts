import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { timelineDocSchema, propsDocSchema, projectDocSchema, eventEnvelopeSchema, globalSettingsSchema, toolInfoSchema, installStateSchema, whisperModelInfoSchema, accountInfoSchema, claudeCodeStatusSchema, defaultGlobalSettings } from '@shared/schema';
import { contract } from '@shared/ipc/contract';
import { projectPathSchema } from '../../src/shared/schema/common';
import { cropSchema } from '../../src/shared/schema/timeline';
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
    const doc = fixture(); const item = doc.tracks[3]?.items[0]; if (item && 'src' in item) item.src = 'raw/../private';
    expect(timelineDocSchema.safeParse(doc).success).toBe(false);
  });
});
describe('literal project paths', () => {
  it.each(['raw/100% done.mp4', 'raw/take%20one.mp4', 'raw/take one.mp4', 'raw/%2e%2e.mp4', 'raw/%00.mp4'])('preserves %s without URL decoding', (rel) => {
    expect(projectPathSchema.parse(rel)).toBe(rel);
  });
  it.each(['../private', '/etc/passwd', 'raw/../private', 'raw/./x', 'raw//x', 'raw/x\0y', 'raw/x\\y', 'C:/private'])('rejects literal traversal or ambiguity %j', (rel) => {
    expect(projectPathSchema.safeParse(rel).success).toBe(false);
  });
});
describe('source-normalized crop', () => {
  it.each([{ x: 0, y: 0, w: 1, h: 1 }, { x: 0.25, y: 0.5, w: 0.75, h: 0.5 }, { x: 0.1, y: 0.1, w: 0.2, h: 0.3 }])('accepts an in-frame crop %j', (crop) => {
    expect(cropSchema.parse(crop)).toEqual(crop);
  });
  it.each([
    { x: -0.01, y: 0, w: 1, h: 1 }, { x: 0, y: -0.01, w: 1, h: 1 },
    { x: 1.01, y: 0, w: 0.1, h: 1 }, { x: 0, y: 1.01, w: 1, h: 0.1 },
    { x: 0, y: 0, w: 0, h: 1 }, { x: 0, y: 0, w: 1, h: 0 },
    { x: 0, y: 0, w: -0.1, h: 1 }, { x: 0, y: 0, w: 1, h: -0.1 },
    { x: 0, y: 0, w: 1.01, h: 1 }, { x: 0, y: 0, w: 1, h: 1.01 },
    { x: 0.5, y: 0, w: 0.51, h: 1 }, { x: 0, y: 0.5, w: 1, h: 0.51 },
    { x: 2, y: 0, w: 5, h: 1 }, { x: NaN, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: Infinity, h: 1 },
  ])('rejects an out-of-frame or invalid crop %j', (crop) => {
    expect(cropSchema.safeParse(crop).success).toBe(false);
  });
});
describe('editable props', () => {
  it('parses text, color and number bindings', () => { expect(propsDocSchema.parse(propsFixture).elements).toHaveLength(1); });
  it('rejects unknown binding forms', () => {
    const doc = structuredClone(propsFixture); const element = doc.elements[0]; if (element) element.props.text.bind = 'onclick';
    expect(propsDocSchema.safeParse(doc).success).toBe(false);
  });
});
describe('settings and installation schema round trips', () => {
  it.each([
    ['tool', toolInfoSchema, { name: 'ffmpeg', version: '9.0.2', path: '/tools/ffmpeg', source: 'downloaded', status: 'ok', verification: 'upstream', install: null, updatable: true, latestVersion: '9.0.3', hint: null, action: null }],
    ['install', installStateSchema, { state: 'downloading', received: 42, total: 100 }],
    ['model', whisperModelInfoSchema, { name: 'large-v3-turbo', sizeBytes: 100, status: 'missing', install: { state: 'queued', received: 0, total: null }, isDefault: false }],
    ['account', accountInfoSchema, { provider: 'openai', status: 'connected', method: 'api-key', keyPreview: '…1234', detail: null, checkedAt: '2026-11-01T12:00:00.000Z' }],
    ['Claude Code', claudeCodeStatusSchema, { available: false, loggedIn: false, authMethod: 'none', email: null, organization: null, cliVersion: null, binarySource: null }],
    ['settings', globalSettingsSchema, defaultGlobalSettings()],
  ] as const)('round-trips %s with Zod and draft-07', (_name, schema, input) => {
    const parsed = schema.parse(input);
    expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const validate = ajv.compile(zodToJsonSchema(schema, { target: 'jsonSchema7', $refStrategy: 'none' }));
    expect(validate(parsed)).toBe(true);
    expect(schema.safeParse({ ...parsed, secret: 'unexpected' }).success).toBe(false);
    expect(validate({ ...parsed, secret: 'unexpected' })).toBe(false);
  });
  it.each([
    { state: 'downloading', received: -1, total: null },
    { state: 'downloading', received: 0.5, total: 10 },
    { state: 'downloading', received: 0, total: 0 },
    { state: 'done', received: 10, total: 10 },
  ])('rejects invalid installation state %j', (state) => { expect(installStateSchema.safeParse(state).success).toBe(false); });
  it.each(['abc', 'key with whitespace', 'x'.repeat(513)])('rejects malformed keys without a permissive request schema', (apiKey) => {
    expect(contract.invoke['accounts.connectKey'].req.safeParse({ provider: 'openai', apiKey }).success).toBe(false);
  });
  it('trims API keys before handing them to an implementation', () => {
    expect(contract.invoke['accounts.connectKey'].req.parse({ provider: 'anthropic', apiKey: '  test-key-1234\n' }).apiKey).toBe('test-key-1234');
  });
  it('rejects full keys in saved account previews and undeclared secret fields', () => {
    const settings = defaultGlobalSettings();
    expect(globalSettingsSchema.safeParse({ ...settings, openai: { apiKey: 'must-not-persist' } }).success).toBe(false);
    settings.accounts.openai.keyPreview = 'full-key-must-not-persist';
    expect(globalSettingsSchema.safeParse(settings).success).toBe(false);
  });
});

describe('generated JSON schemas', () => {
  it.each([['timeline', timelineDocSchema], ['props', propsDocSchema], ['project', projectDocSchema], ['events', eventEnvelopeSchema], ['settings', globalSettingsSchema], ['tools', toolInfoSchema], ['install', installStateSchema], ['models', whisperModelInfoSchema], ['accounts', accountInfoSchema], ['claudeCodeStatus', claudeCodeStatusSchema]] as const)('%s is valid draft-07', (_name, schema) => {
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
