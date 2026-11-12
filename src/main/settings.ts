// Settings: how Claude is connected, which model runs, and what else the agent can reach.
// Stored encrypted (macOS Keychain-backed) because it holds API keys.
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import { safeStorage, systemPreferences } from 'electron';
import { patchProject, readProject } from '../cli/project';
import { HOME, run } from '../cli/run';
import { CONNECTIONS, LOCAL_CUTOUT, featureStates, llmProviders } from '../shared/features';
import type { Connection, Feature, FeatureState } from '../shared/features';
import { modelOptions } from '../shared/types';
import type { ClaudeStatus, ModelChoice, Settings, Voice } from '../shared/types';

const FILE = path.join(HOME, 'settings.enc');
const DEFAULTS: Settings = {
  claude: { auth: 'claude-code', apiKey: '' },
  model: '',
  providers: [],
  elevenlabs: { mode: 'off', apiKey: '' },
  mcp: [],
  keys: Object.fromEntries(Object.keys(CONNECTIONS).map((id) => [id, ''])) as Settings['keys'],
  llmModels: {},
  features: {},
};
export async function loadSettings(): Promise<Settings> {
  try {
    const saved = JSON.parse(safeStorage.decryptString(await readFile(FILE))) as Partial<Settings>;
    return { ...DEFAULTS, ...saved, keys: { ...DEFAULTS.keys, ...saved.keys } };
  } catch {
    return DEFAULTS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('The system keychain is unavailable, so keys cannot be stored safely.');
  await mkdir(HOME, { recursive: true });
  await writeFile(FILE, safeStorage.encryptString(JSON.stringify(settings)), { mode: 0o600 });
}

// --- Models ------------------------------------------------------------------------------

export async function modelChoice(root: string): Promise<ModelChoice> {
  const settings = await loadSettings();
  const options = modelOptions(settings);
  // A project may point at a provider that has since been removed: fall back to the default.
  const known = (id?: string): string => (options.some((o) => o.id === id) ? id! : '');
  return { project: known((await readProject(root)).model), default: known(settings.model), options };
}

export const setProjectModel = (root: string, model: string): Promise<void> => patchProject(root, { model });

/** Feature states for the Features pages. `root` is the open project, if any. */
export async function features(root?: string): Promise<FeatureState[]> {
  const off = root ? ((await readProject(root)).off ?? []) : [];
  return featureStates(await loadSettings(), off, (await codexStatus()).loggedIn);
}

export async function setProjectFeature(root: string, id: Feature, on: boolean): Promise<FeatureState[]> {
  const off = new Set((await readProject(root)).off ?? []);
  if (on) off.delete(id);
  else off.add(id);
  await patchProject(root, { off: [...off] });
  return features(root);
}

// --- What the agent session gets -----------------------------------------------------------

export interface AgentConfig {
  env: Record<string, string | undefined>;
  model: string | undefined;
  mcpServers: Record<string, McpServerConfig>;
  /** Extra system-prompt lines about connected services. */
  notes: string;
}

/** Split `npx -y "some server" --flag` into words. */
const words = (line: string): string[] => (line.match(/"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^"|"$/g, ''));

export async function agentConfig(root: string): Promise<AgentConfig> {
  const settings = await loadSettings();
  const choice = await modelChoice(root);
  let model = choice.project || choice.default || undefined;
  const env: AgentConfig['env'] = { ...process.env };
  let notes = '';

  // Claude itself: the Claude Code sign-in, or an API key.
  if (settings.claude.auth === 'api-key') env.ANTHROPIC_API_KEY = settings.claude.apiKey;
  else delete env.ANTHROPIC_API_KEY;

  // A model from another provider: point Claude Code at that Anthropic-compatible endpoint.
  const provider = llmProviders(settings).find((p) => model?.startsWith(`${p.name}/`));
  if (provider && model) {
    model = model.slice(provider.name.length + 1);
    delete env.ANTHROPIC_API_KEY;
    env.ANTHROPIC_BASE_URL = provider.baseUrl;
    env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = model; // background requests must use a model the endpoint has
  }

  const mcpServers: AgentConfig['mcpServers'] = {};
  for (const server of settings.mcp) {
    const [command, ...args] = words(server.target);
    if (!command) continue;
    mcpServers[server.name.replace(/[^\w-]+/g, '-')] = /^https?:\/\//.test(command)
      ? { type: 'http', url: command, headers: server.env }
      : { command, args, env: server.env };
  }

  // Features: only what is switched on, connected and not switched off for this project reaches the agent.
  const states = await features(root);
  const active = (id: Feature): boolean => states.find((s) => s.id === id)!.active;
  const uses = (connection: Connection): boolean => states.some((s) => s.active && s.model?.startsWith(`${connection}:`));

  const { mode, apiKey, voice } = settings.elevenlabs;
  if (active('voiceover') || active('music') || active('sfx')) {
    if (mode === 'api') env.ELEVENLABS_API_KEY = apiKey;
    else mcpServers.elevenlabs = { command: 'uvx', args: ['elevenlabs-mcp'], env: { ELEVENLABS_API_KEY: apiKey, ELEVENLABS_MCP_BASE_PATH: path.join(root, 'assets') } };
    notes += mode === 'api'
      ? '\nElevenLabs is connected: use the elevenlabs skill.'
      : '\nElevenLabs is connected through the mcp__elevenlabs tools. Save results in assets/ and put them on the timeline as audio.';
    if (voice && active('voiceover')) notes += ` The user's own voice is "${voice.name}" (voice_id ${voice.id}): use it for voice-over unless they ask for another.`;
  }
  if (active('localSfx')) notes += '\nSimple sound effects can be made locally and for free: use the sound-effects skill.';
  if (uses('fal')) env.FAL_KEY = settings.keys.fal;
  if (uses('openrouter')) env.OPENROUTER_API_KEY = settings.keys.openrouter;
  if (uses('alibaba')) env.DASHSCOPE_API_KEY = settings.keys.alibaba;
  if (uses('theta')) {
    mcpServers.theta = { type: 'http', url: 'https://controller.thetaedgecloud.com/mcp', headers: { Authorization: `Bearer ${settings.keys.theta}` } };
  }
  if (active('codex')) {
    mcpServers.codex = { command: 'codex', args: ['mcp-server'] };
    notes += '\nOpenAI Codex is connected through the mcp__codex tools. Use it only when the user asks for Codex or for a second opinion.';
  }
  if (states.some((s) => s.id === 'cutout' && s.active && s.model === LOCAL_CUTOUT)) {
    notes += '\nSubject cutouts and stickers are made on this Mac, free: use the cutout skill.';
  }
  const generated = states.filter((s) => s.active && s.model && !s.model.startsWith('local:'));
  if (generated.length) {
    notes += `\nAI generation is connected: use the generate skill. The user's model for each task:\n${generated.map((s) => `  ${s.label}: ${s.model}`).join('\n')}`;
  }
  const list = (items: FeatureState[]): string => items.map((s) => s.label).join('; ') || 'none';
  notes = `

# Features in this project

The user decides what you may use. This list is authoritative: do not probe the environment to second-guess it.
- Available: ${list(states.filter((s) => s.active))}
- Switched off by the user — do not use them and do not work around them: ${list(states.filter((s) => !s.active && s.connected))}
- Not connected — if one is needed, say it can be connected in Settings: ${list(states.filter((s) => !s.connected))}
${notes}`;
  return { env, model, mcpServers, notes };
}

// --- Connections shown in Settings -----------------------------------------------------------

/** The Claude Code binary bundled with the Agent SDK, or one on PATH. */
function claudeBinary(): string {
  try {
    const pkg = createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    return path.join(path.dirname(pkg), 'claude');
  } catch {
    return 'claude';
  }
}

export async function claudeStatus(): Promise<ClaudeStatus> {
  try {
    const status = JSON.parse(await run(claudeBinary(), ['auth', 'status'])) as { loggedIn: boolean; email?: string; subscriptionType?: string };
    return status.loggedIn
      ? { loggedIn: true, detail: [status.email, status.subscriptionType].filter(Boolean).join(' · ') }
      : { loggedIn: false, detail: 'Not signed in' };
  } catch {
    return { loggedIn: false, detail: 'Not signed in' };
  }
}

/** Sign-in happens in Terminal with the official CLI, so Cutroom never sees the credentials. */
export async function claudeLogin(): Promise<void> {
  const script = `tell application "Terminal"\nactivate\ndo script "'${claudeBinary()}' auth login"\nend tell`;
  spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
}

// Codex ships as a dependency; tools.ts puts a `codex` launcher on PATH.
export const codexStatus = (): Promise<ClaudeStatus> =>
  run('codex', ['login', 'status']).then(
    () => ({ loggedIn: true, detail: 'Signed in' }),
    () => ({ loggedIn: false, detail: 'Not signed in' }),
  );

/** OpenAI's own browser sign-in (ChatGPT account). Resolves when the browser flow finishes. */
export const codexLogin = (): Promise<ClaudeStatus> => run('codex', ['login']).then(codexStatus, codexStatus);

const ELEVEN = 'https://api.elevenlabs.io/v1';
async function eleven<T>(apiKey: string, route: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(ELEVEN + route, { ...init, headers: { 'xi-api-key': apiKey } });
  if (res.ok) return (await res.json()) as T;
  const detail = ((await res.json().catch(() => null)) as { detail?: { message?: string } } | null)?.detail?.message;
  throw new Error(res.status === 401 ? 'ElevenLabs did not accept this API key.' : (detail ?? `ElevenLabs answered ${res.status}.`));
}

export const micAccess = (): Promise<boolean> => systemPreferences.askForMediaAccess('microphone');

/** Clone a voice from a recording made in Settings. The recording is converted to MP3 first. */
export async function cloneVoice(apiKey: string, name: string, recording: ArrayBuffer): Promise<Voice> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'cutroom-voice-'));
  try {
    await writeFile(path.join(tmp, 'in.webm'), Buffer.from(recording));
    await run('ffmpeg', ['-v', 'error', '-i', path.join(tmp, 'in.webm'), '-ac', '1', '-ar', '44100', path.join(tmp, 'voice.mp3')]);
    const form = new FormData();
    form.set('name', name);
    form.set('files', new Blob([new Uint8Array(await readFile(path.join(tmp, 'voice.mp3')))], { type: 'audio/mpeg' }), 'voice.mp3');
    const { voice_id } = await eleven<{ voice_id: string }>(apiKey, '/voices/add', { method: 'POST', body: form });
    return { id: voice_id, name, category: 'cloned' };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export const deleteVoice = async (apiKey: string, id: string): Promise<void> =>
  void (await eleven(apiKey, `/voices/${encodeURIComponent(id)}`, { method: 'DELETE' }));

export async function voices(apiKey: string): Promise<Voice[]> {
  const body = await eleven<{ voices: { voice_id: string; name: string; category?: string }[] }>(apiKey, '/voices');
  return body.voices.map((v) => ({ id: v.voice_id, name: v.name, category: v.category ?? '' }));
}
