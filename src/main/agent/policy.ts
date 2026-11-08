import path from 'node:path';
import { realpath } from 'node:fs/promises';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { GlobalSettings } from '@shared/schema/settings';
import { resolveInProject } from '../fs/safePath';

const readTools = new Set(['project_info', 'media_list', 'media_probe', 'timeline_get', 'playhead_get', 'selection_get', 'playhead_seek', 'transcript_get', 'compositions_list', 'compositions_check', 'export_preflight', 'job_status', 'url_import_fetch', 'skills_list', 'skill_read']);
const writeTools = new Set(['timeline_apply', 'transcribe_start', 'captions_generate', 'compositions_create', 'export_start', 'snapshot_create', 'skill_apply']);
export function classifyTool(name: string, options: { mode: 'ask' | 'edit'; approvalMode: 'auto' | 'ask'; extensionIds: readonly string[]; input?: Record<string, unknown> }): 'allow' | 'ask' | 'self_confirm' {
  if (['Read', 'Glob', 'Grep'].includes(name)) return 'allow';
  if (options.extensionIds.some((id) => name.startsWith(`mcp__${id}__`))) return 'ask';
  if (name.startsWith('mcp__cutroom__')) {
    const tool = name.slice('mcp__cutroom__'.length);
    if (readTools.has(tool)) return 'allow';
    if (['url_import_download', 'skill_save'].includes(tool) || (tool === 'timeline_apply' && options.input?.force === true)) return 'self_confirm';
    if (!writeTools.has(tool)) return 'ask';
  } else if (!['Write', 'Edit', 'Bash', 'WebSearch', 'WebFetch'].includes(name) && !/^mcp__(elevenlabs|codex)__/.test(name)) return 'ask';
  return options.mode === 'edit' && options.approvalMode === 'auto' ? 'allow' : 'ask';
}

export const AGENT_MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const;
export function agentPolicy(root: string, mode: 'ask' | 'edit', settings: GlobalSettings): Pick<Options, 'tools' | 'allowedTools' | 'disallowedTools' | 'sandbox' | 'settingSources'> {
  const writes = mode === 'edit'; const shell = writes && settings.sandbox.allowShell;
  return { settingSources: [], tools: ['Read', 'Glob', 'Grep', 'AskUserQuestion', ...(writes ? ['Write', 'Edit'] : []), ...(shell ? ['Bash'] : []), ...(settings.sandbox.allowWeb ? ['WebSearch', 'WebFetch'] : [])], allowedTools: ['Read', 'Glob', 'Grep'], disallowedTools: [...(!shell ? ['Bash'] : []), ...(!writes ? ['Write', 'Edit', 'NotebookEdit'] : ['NotebookEdit']), ...(!settings.sandbox.allowWeb ? ['WebSearch', 'WebFetch'] : [])], sandbox: {
    enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false,
    network: { allowedDomains: settings.sandbox.allowedDomains, strictAllowlist: true, allowLocalBinding: false, allowAllUnixSockets: false },
    filesystem: { allowWrite: writes ? [path.join(root, 'compositions'), path.join(root, 'work')] : [], denyWrite: ['.', path.join(root, 'raw'), path.join(root, 'references'), path.join(root, 'assets'), path.join(root, '.cutroom'), path.join(root, 'timeline.json')] },
  } };
}
/** Builtin file tools cannot escape cwd; mutations are confined to two generated folders. */
export async function guardAgentFile(root: string, tool: string, input: Record<string, unknown>, mode: 'ask' | 'edit'): Promise<void> {
  const write = tool === 'Write' || tool === 'Edit'; if (write && mode === 'ask') throw new Error('Ask mode is read-only.');
  if (!write && !['Read', 'Glob', 'Grep'].includes(tool)) return;
  const raw = input.file_path ?? input.path ?? '.'; if (typeof raw !== 'string') throw new Error('Expected a project path.');
  const rel = path.isAbsolute(raw) ? path.relative(root, raw) : raw;
  if (write && !/^(compositions|work)\/.+/.test(rel)) throw new Error('Writes are allowed only in compositions/ and work/.');
  if (rel === '.' || rel === '') { if (write) throw new Error('Cannot replace a project directory.'); return; }
  const resolved = await resolveInProject(root, rel, { write });
  if (write) {
    const actual = path.relative(await realpath(root), resolved); if (!/^(compositions|work)\/.+/.test(actual)) throw new Error('Symlink leaves the generated folders.');
  }
}
