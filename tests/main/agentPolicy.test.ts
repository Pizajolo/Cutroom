import { expect, it } from 'vitest';
import { classifyTool } from '@main/agent/policy';
import { needsBrief } from '@main/agent/briefGate';

it.each(['auto', 'ask'] as const)('never prompts for reads or double-prompts self-confirming tools in %s', (approvalMode) => {
  const options = { mode: 'edit' as const, approvalMode, extensionIds: ['research'] };
  for (const tool of ['Read', 'Glob', 'Grep', 'mcp__cutroom__timeline_get', 'mcp__cutroom__skills_list', 'mcp__cutroom__skill_read']) expect(classifyTool(tool, options)).toBe('allow');
  for (const tool of ['mcp__cutroom__url_import_download', 'mcp__cutroom__skill_save']) expect(classifyTool(tool, options)).toBe('self_confirm');
  expect(classifyTool('mcp__cutroom__timeline_apply', { ...options, input: { force: true } })).toBe('self_confirm');
  expect(classifyTool('mcp__research__read', options)).toBe('ask'); expect(classifyTool('mcp__unknown__write', options)).toBe('ask');
});
it.each(['Write', 'Edit', 'Bash', 'WebSearch', 'WebFetch', 'mcp__cutroom__timeline_apply', 'mcp__cutroom__skill_apply', 'mcp__elevenlabs__music', 'mcp__codex__codex_task'])('auto-approves %s only in Edit/auto', (tool) => {
  expect(classifyTool(tool, { mode: 'edit', approvalMode: 'auto', extensionIds: [] })).toBe('allow');
  expect(classifyTool(tool, { mode: 'edit', approvalMode: 'ask', extensionIds: [] })).toBe('ask');
  expect(classifyTool(tool, { mode: 'ask', approvalMode: 'auto', extensionIds: [] })).toBe('ask');
});
it('gates only the short, reference-free, URL-free, skill-free empty edit', () => {
  const thin = { text: 'Make a cool video', referenceCount: 0, hasUrl: false, itemCount: 0 };
  expect(needsBrief(thin)).toBe(true);
  for (const extra of [{ text: 'one two three four five six seven eight nine ten eleven twelve' }, { referenceCount: 1 }, { hasUrl: true }, { itemCount: 1 }, { skillId: 'podcast-clip' }]) expect(needsBrief({ ...thin, ...extra })).toBe(false);
});
