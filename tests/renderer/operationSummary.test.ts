import { describe, expect, it } from 'vitest';
import { summarizeOperation } from '../../src/renderer/editor/operationSummary';

describe('permission operation summaries', () => {
  it('preserves exact ordinary commands and affected properties', () => {
    const input = { command: 'ffmpeg -i "raw/my clip.mp4" "work/output.mov"', itemIds: ['clip_0000000001'], paths: ['volume'], patch: { volume: 0.5 } };
    const summary = summarizeOperation(input);
    expect(summary.truncated).toBe(false);
    expect(JSON.parse(summary.text)).toEqual(input);
  });
  it('redacts structured secrets, headers and environment values at every depth', () => {
    const summary = summarizeOperation({ api_key: 'one', nested: { accessKeyId: 'two', authorization: 'three', password: 'four', headers: { arbitrary: 'five' }, env: { CUSTOM: 'six' }, target: 'work/preview.mov' } });
    for (const value of ['one', 'two', 'three', 'four', 'five', 'six']) expect(summary.text).not.toContain(`"${value}"`);
    expect(summary.text).toContain('work/preview.mov');
    expect(summary.truncated).toBe(false);
  });
  it.each([
    'curl --api-key "sensitive-value" https://service.test',
    'AWS_ACCESS_KEY_ID=sensitive-value tool work/out.wav',
    'curl -H "Authorization: sensitive-value" https://service.test',
    'curl --cookie "sensitive-value" https://service.test',
    'curl https://user:sensitive-value@service.test/path?token=sensitive-value',
    'curl -H "Authorization: Bearer sensitive-value" https://service.test',
  ])('redacts credential-bearing shell arguments: %s', (command) => {
    const summary = summarizeOperation({ command });
    expect(summary.text).not.toContain('sensitive-value');
    expect(summary.text).toContain('[redacted]');
    expect(summary.truncated).toBe(false);
  });
  it('bounds collection, nesting and string sizes explicitly', () => {
    expect(summarizeOperation(Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`path${i}`, 'x']))).truncated).toBe(true);
    expect(summarizeOperation({ a: { b: { c: { d: { e: { f: { value: 1 } } } } } } }).truncated).toBe(true);
    const huge = summarizeOperation({ command: 'x'.repeat(100000) });
    expect(huge.truncated).toBe(true); expect(huge.text.length).toBeLessThan(16100);
  });
  it('makes invisible direction controls visible instead of letting them reorder the command', () => {
    const summary = summarizeOperation({ command: `ls work/${String.fromCharCode(0x202e)}hidden` });
    expect(summary.text).not.toContain(String.fromCharCode(0x202e));
    expect(summary.text).toContain('u202e');
  });
});
