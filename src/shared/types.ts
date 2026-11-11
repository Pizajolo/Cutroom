// Types shared by the CLI, the Electron main process and the renderer.
import { llmProviders } from './features';
import type { Connection, Feature, FeatureState } from './features';

/** The four folders every project has. Everything Cutroom generates lives in `.cutroom/`. */
export const PROJECT_DIRS = ['raw', 'references', 'exports', 'assets'] as const;
/** Where the user can put files they add. */
export type ImportDir = 'raw' | 'references' | 'assets';
export const TIMELINE_FILE = '.cutroom/timeline.json';
export const PREVIEW_FILE = '.cutroom/preview.mp4';
export const SCRIPT_FILE = '.cutroom/script.md';

/** Colour correction. Every field is optional; omitted = unchanged. */
export interface Grade {
  /** -1..1, default 0. */
  brightness?: number;
  /** 0..2, default 1. */
  contrast?: number;
  /** 0..3, default 1 (0 = black and white). */
  saturation?: number;
  /** 0.1..10, default 1. */
  gamma?: number;
  /** White balance in Kelvin, default 6500 (lower = warmer). */
  temperature?: number;
  /** Project-relative path to a .cube LUT. */
  lut?: string;
}

/** How a picture is treated before it is placed: cropped, graded, filtered. */
interface Look {
  /** Region of the source to keep, as fractions (0..1) of its width and height. */
  crop?: { x: number; y: number; w: number; h: number };
  grade?: Grade;
  /** Escape hatch: a raw FFmpeg video filter chain, e.g. `vignette,gblur=2`. */
  filter?: string;
}

/** A piece of source footage on the main track. Clips play back to back, in order. */
export interface Clip extends Look {
  id: string;
  /** Project-relative path, e.g. `raw/IMG_9512.mov`. */
  src: string;
  /** Source in/out points in seconds. */
  in: number;
  out: number;
  /** Playback speed, default 1 (0.5 = slow motion, 2 = double speed). */
  speed?: number;
  /** 0..1+, default 1. */
  volume?: number;
  /** `cover` (default) fills the frame and crops; `contain` shows everything with bars. */
  fit?: 'cover' | 'contain';
  label?: string;
}

/**
 * Anything above the main track: b-roll, picture-in-picture, cutouts, graphics, logos.
 * Videos (with or without transparency) and images. Later overlays sit on top of earlier ones.
 */
export interface Overlay extends Look {
  id: string;
  src: string;
  /** Position on the output timeline, in seconds. */
  at: number;
  duration: number;
  /** Offset into the source video, default 0. */
  in?: number;
  /** Placement as fractions of the frame (top-left x/y, width). Omitted = full frame. */
  x?: number;
  y?: number;
  w?: number;
  /** 0..1, default 1. */
  opacity?: number;
  /** The overlay video's own sound. Default 0 (muted). */
  volume?: number;
  /** Seconds to fade in / out. */
  fadeIn?: number;
  fadeOut?: number;
  /** Green-screen colour to make transparent, e.g. `#00ff00`. */
  key?: string;
  label?: string;
}

/** Music, sound effects or voice-over mixed under the clips. */
export interface AudioItem {
  id: string;
  src: string;
  at: number;
  /** Offset into the source, default 0. */
  in?: number;
  /** Default: to the end of the source or the edit, whichever comes first. */
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  label?: string;
}

export interface Timeline {
  width: number;
  height: number;
  fps: number;
  /** Look applied to all footage on the main track (not to overlays). */
  grade?: Grade;
  clips: Clip[];
  overlays: Overlay[];
  audio: AudioItem[];
}

export const EMPTY_TIMELINE: Timeline = { width: 1080, height: 1920, fps: 30, clips: [], overlays: [], audio: [] };

export const clipLength = (c: Clip): number => Math.max(0, c.out - c.in) / (c.speed || 1);
export const timelineLength = (t: Timeline): number =>
  t.clips.reduce((sum, c) => sum + clipLength(c), 0);

/** Start time of each clip on the output timeline. */
export function clipStarts(t: Timeline): number[] {
  let at = 0;
  return t.clips.map((c) => {
    const start = at;
    at += clipLength(c);
    return start;
  });
}

/** Something the user pointed at: a frame, a range of the edit, or a timeline item. */
export interface Mark {
  /** Seconds on the output timeline. */
  start: number;
  end?: number;
  /** Set when the user marked a specific clip / overlay / audio item. */
  itemId?: string;
}

export interface MediaFile {
  /** Project-relative path. */
  path: string;
  dir: (typeof PROJECT_DIRS)[number];
  kind: 'video' | 'audio' | 'image' | 'other';
}

export interface Project {
  root: string;
  name: string;
}

export interface Skill {
  /** Name as the agent sees it, e.g. `cutroom:talking-head-short`. */
  id: string;
  name: string;
  description: string;
  /** True for skills the user saved from their own edits. */
  custom: boolean;
  /** `media://` address of the video the style was saved from, if it has one. */
  example?: string;
  /** Exported videos made with this style (absolute paths). */
  videos: string[];
}

/** Skills that are tools rather than editing styles. */
export const UTILITY_SKILLS = ['cutroom:save-style', 'cutroom:elevenlabs', 'cutroom:generate'];

export interface ToolStatus {
  name: string;
  state: 'ready' | 'installing' | 'missing';
  detail?: string;
}

/** An Anthropic-compatible endpoint (a gateway such as OpenRouter or LiteLLM, a proxy, a local server). */
export interface Provider {
  name: string;
  baseUrl: string;
  apiKey: string;
  /** Model ids this endpoint serves, as the endpoint names them. */
  models: string[];
}

/** An extra MCP server for the agent: a local command or a remote URL. */
export interface McpServer {
  name: string;
  /** `npx -y some-server --flag` or `https://example.com/mcp`. */
  target: string;
  /** For commands: environment variables. For URLs: request headers. */
  env: Record<string, string>;
}

export interface Settings {
  claude: { auth: 'claude-code' | 'api-key'; apiKey: string };
  /** Default model: '' = Claude Code's own default, a Claude model id, or `<provider name>/<model>`. */
  model: string;
  providers: Provider[];
  /** `api`: the agent calls the ElevenLabs API itself. `mcp`: it uses the official ElevenLabs MCP server. */
  elevenlabs: { mode: 'off' | 'api' | 'mcp'; apiKey: string; /** The user's own voice, preferred for voice-over. */ voice?: Voice };
  mcp: McpServer[];
  /** API keys of connected accounts (see CONNECTIONS). */
  keys: Record<Connection, string>;
  /** Brain models offered by a connected account, comma-separated; empty = its defaults. */
  llmModels: Partial<Record<Connection, string>>;
  /** Features switched off, and the provider/model chosen for generated media. */
  features: Partial<Record<Feature, { on?: boolean; model?: string }>>;
}

export interface ModelOption {
  id: string;
  label: string;
}

const CLAUDE_MODELS: ModelOption[] = [
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
];

/** Every model the user can pick: Claude's own, plus those of the providers they added. */
export const modelOptions = (settings: Settings): ModelOption[] => [
  { id: '', label: 'Claude Code default' },
  ...CLAUDE_MODELS,
  ...llmProviders(settings).flatMap((p) => p.models.map((m) => ({ id: `${p.name}/${m}`, label: `${m} · ${p.name}` }))),
];

/** The model the current project uses: its own override, or the default from Settings. */
export interface ModelChoice {
  project: string;
  default: string;
  options: ModelOption[];
}

/** Sign-in state of Claude Code or Codex. */
export interface ClaudeStatus {
  loggedIn: boolean;
  detail: string;
}

export interface Voice {
  id: string;
  name: string;
  /** ElevenLabs category: `cloned`, `generated`, `premade`, … */
  category: string;
}

export type ChatPart = { type: 'text'; text: string } | { type: 'tool'; text: string };

export interface ChatMessage {
  role: 'user' | 'assistant';
  parts: ChatPart[];
  marks?: Mark[];
  /** Footage the user picked for this request. */
  files?: string[];
  /** On a reply: the edit as it was before Claude started, so the step can be taken back. */
  before?: Timeline;
  error?: boolean;
}

/** The written plan for the video. `pending` = written or changed since the last edit, so it awaits approval. */
export interface Script {
  text: string;
  pending: boolean;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; text: string }
  | { type: 'done'; error?: string };

/** `window.cutroom`, exposed by the preload script. */
export interface CutroomApi {
  openProject(): Promise<Project | null>;
  recentProjects(): Promise<Project[]>;
  openRecent(root: string): Promise<Project | null>;
  /** Copy files into the project (a file dialog opens without `paths`); without `dir` they are sorted by type. */
  importFiles(paths?: string[], dir?: ImportDir): Promise<void>;
  /** Download videos from links into `dir` (default references/). Resolves with one message per failed link. */
  downloadLinks(urls: string[], dir?: ImportDir): Promise<string[]>;
  pathForFile(file: File): string;
  listMedia(): Promise<MediaFile[]>;
  getTimeline(): Promise<Timeline | null>;
  /** Duration of a media file in seconds (0 for images). */
  duration(path: string): Promise<number>;
  saveTimeline(timeline: Timeline): Promise<void>;
  loadChat(): Promise<ChatMessage[]>;
  saveChat(messages: ChatMessage[]): Promise<void>;
  send(text: string, marks: Mark[], files: string[]): Promise<void>;
  getScript(): Promise<Script>;
  stop(): Promise<void>;
  exportVideo(): Promise<string>;
  reveal(path: string): Promise<void>;
  closeProject(): Promise<void>;
  forgetProject(root: string): Promise<Project[]>;
  listSkills(): Promise<Skill[]>;
  revealSkill(id: string): Promise<void>;
  /** The style's SKILL.md. */
  readSkill(id: string): Promise<string>;
  /** Rewrite one of the user's own styles. */
  saveSkill(id: string, text: string): Promise<Skill[]>;
  /** Open a video listed under a style in the default player. */
  openVideo(path: string): Promise<void>;
  /** Moves a saved style to the Trash. */
  deleteSkill(id: string): Promise<Skill[]>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  claudeStatus(): Promise<ClaudeStatus>;
  /** Opens Terminal on the official `claude auth login`. */
  claudeLogin(): Promise<void>;
  /** Codex is reached through Claude Code; sign-in is OpenAI's own browser login. */
  codexStatus(): Promise<ClaudeStatus>;
  codexLogin(): Promise<ClaudeStatus>;
  /** The voices in the connected ElevenLabs account. */
  voices(apiKey: string): Promise<Voice[]>;
  /** Asks macOS for microphone access. */
  micAccess(): Promise<boolean>;
  /** Clones a voice from a recording and returns it. */
  cloneVoice(apiKey: string, name: string, recording: ArrayBuffer): Promise<Voice>;
  deleteVoice(apiKey: string, id: string): Promise<void>;
  /** Every feature with its state; `offHere` reflects the open project, if any. */
  features(): Promise<FeatureState[]>;
  /** Switch a feature off or on for the open project only. */
  setProjectFeature(id: Feature, on: boolean): Promise<FeatureState[]>;
  getModel(): Promise<ModelChoice>;
  setProjectModel(model: string): Promise<void>;
  tools(): Promise<ToolStatus[]>;
  on(channel: 'agent', fn: (event: AgentEvent) => void): () => void;
  on(channel: 'script', fn: (script: Script) => void): () => void;
  on(channel: 'timeline', fn: (timeline: Timeline | null) => void): () => void;
  on(channel: 'preview', fn: (state: { rendering: boolean; version: number; error?: string }) => void): () => void;
  on(channel: 'media', fn: (files: MediaFile[]) => void): () => void;
  on(channel: 'tools', fn: (tools: ToolStatus[]) => void): () => void;
}
