// Types shared by the CLI, the Electron main process and the renderer.
import { llmProviders } from './features';
import type { Connection, Feature, FeatureState } from './features';
import type { BrandKit, BrandSlot, LogoSlot } from './brand';
import type { ExportedVideo, SocialPlatform, SocialSettings, SocialStatus } from './social';

/** The four folders every project has. Everything Cutroom generates lives in `.cutroom/`. */
export const PROJECT_DIRS = ['raw', 'references', 'exports', 'assets'] as const;
/** Where the user can put files they add. */
export type ImportDir = 'raw' | 'references' | 'assets';

/**
 * A project holds several cuts: each is one chat with its own edit, kept in `.cutroom/cuts/<id>/`.
 * Footage, transcripts, sources and project settings are shared by all of them.
 */
export interface Cut {
  id: string;
  name: string;
  /** The cut this one was split from. */
  from?: string;
  /** The brand kit this chat's video uses (its id), if any. */
  brand?: string;
}

/** Project-relative paths of one cut's files. */
export function cutFiles(cut: string) {
  const dir = `.cutroom/cuts/${cut}`;
  return {
    dir,
    timeline: `${dir}/timeline.json`,
    preview: `${dir}/preview.mp4`,
    script: `${dir}/script.md`,
    /** Exists while a spoken cut waits for the user's approval. */
    spokenCut: `${dir}/spoken-cut`,
    /** Written when the user approves a recording script, so it stops waiting for approval until it changes again. */
    scriptApproved: `${dir}/script-approved`,
    versions: `${dir}/versions.json`,
    chat: `${dir}/chat.json`,
    /** Claude's session id, so the conversation continues where it left off. */
    session: `${dir}/session`,
    /** Set on a cut that was split off and has not talked to Claude yet: where its session branches. */
    fork: `${dir}/fork.json`,
    /** The brand kit as Claude last saw it in this chat, so it can be told when it changes. */
    brandSeen: `${dir}/brand-seen.json`,
  };
}

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
  /** Picture switched off: the clip still takes its time, shown as black. */
  hidden?: boolean;
  /** Its sound switched off. */
  muted?: boolean;
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
  /** Playback speed of a video layer, default 1. `duration` is output time, so it covers `duration × speed` of the source. */
  speed?: number;
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
  /** Switched off: not drawn (its sound, if any, still plays unless muted). */
  hidden?: boolean;
  muted?: boolean;
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
  /**
   * Dip under speech: while someone talks on the main track this item is pulled down (by about 10 dB at the default
   * strength) and comes back up in the pauses. For music beds; leave it off for sound effects.
   * true = default strength, or a number of dB (3–20).
   */
  duck?: boolean | number;
  muted?: boolean;
  label?: string;
}

/** Loudness the export is levelled to, in LUFS: about what TikTok, Reels, Shorts and YouTube play at. */
export const DEFAULT_LOUDNESS = -14;

/** The preview render: whether one is running and how far along (0–1), the version on screen, and any error. */
export interface PreviewState {
  rendering: boolean;
  version: number;
  error?: string;
  progress?: number;
  /** `proxies`: making light copies of heavy footage first (once per file). */
  stage?: 'proxies' | 'render';
}

export type TrackName = 'clips' | 'overlays' | 'audio';

/** Switches on a whole track, as in any editor's track header. */
export interface TrackState {
  /** Picture off for everything on the track. */
  hidden?: boolean;
  /** Sound off for everything on the track. */
  muted?: boolean;
  /** Only soloed tracks are heard, while any track is soloed. */
  solo?: boolean;
  /** Protected from changes, by the user and by Claude. */
  locked?: boolean;
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
  tracks?: Partial<Record<TrackName, TrackState>>;
  /**
   * Level the finished mix to this loudness (LUFS, default -14) with peaks kept under -1 dBTP, so the video is
   * neither quieter nor louder than everything else in the feed. false leaves the mix as it is.
   */
  loudness?: number | false;
}

/** Whether an item is seen and heard, after its own switches and its track's (mute, hide, solo). */
export function playState(t: Timeline, track: TrackName, item: { hidden?: boolean; muted?: boolean }): { visible: boolean; audible: boolean } {
  const state = t.tracks?.[track] ?? {};
  const soloing = Object.values(t.tracks ?? {}).some((s) => s?.solo);
  return {
    visible: !item.hidden && !state.hidden,
    audible: !item.muted && !state.muted && (!soloing || !!state.solo),
  };
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
  /** What should change here, in the user's words. Several noted marks can go out in one message. */
  note?: string;
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
  /** Installed from the Skill Marketplace (id `market:<slug>`): read-only, updated from there. */
  market?: { slug: string; version: number };
  /** A style shapes a whole video; a move is one technique that can be used in any video. */
  kind: 'style' | 'move';
  tags: string[];
  /** Starred by the user: listed first when picking styles and moves in a project. */
  favorite: boolean;
  /** For a move learned from someone else's video: creator and link. */
  source?: string;
  /** Videos that show the style: the one it was saved from, then every export made with it. */
  examples: Example[];
}

export interface Example {
  /** Absolute path of the video. */
  file: string;
  /** `media://` address the UI can play. */
  src: string;
  label: string;
}

// --- Skill Marketplace (cutroom-market API) --------------------------------------------------------

export interface MarketSkill {
  slug: string;
  name: string;
  kind: 'style' | 'move';
  description: string;
  tags: string[];
  source?: string;
  price: { cents: number; currency: string };
  author: { handle: string; name: string; avatar?: string };
  stats: { downloads: number; rating: number; ratings: number; favorites: number };
  version: number | null;
  exampleUrl?: string;
  status: 'draft' | 'pending' | 'published' | 'rejected' | 'unlisted' | 'removed';
  publishedAt: string | null;
  updatedAt: string;
}

export interface MarketReview {
  id: string;
  rating: number;
  body: string;
  author: { handle: string; name: string; avatar?: string };
  createdAt: string;
  updatedAt: string;
  mine: boolean;
}

export interface MarketDetail extends MarketSkill {
  instructions: string;
  files: { path: string; size: number }[];
  versions: { version: number; changelog: string; date: string }[];
  viewer: { signedIn: boolean; favorite: boolean; installed: boolean; installedVersion?: number; owned: boolean; purchased: boolean; canDownload: boolean; reviewed: boolean };
  reviews: MarketReview[];
}

export interface MarketQuery {
  q?: string;
  kind?: 'style' | 'move';
  tag?: string;
  price?: 'free' | 'paid';
  sort?: 'popular' | 'rating' | 'new' | 'favorites';
  page?: number;
  pageSize?: number;
}

export interface MarketPage {
  skills: MarketSkill[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MarketAccount {
  signedIn: boolean;
  /** The marketplace this app talks to. */
  url: string;
  /** The marketplace sells skills. Without payments set up, every skill is free and prices are hidden. */
  payments: boolean;
  user?: { id: string; handle: string; name: string; avatar?: string; email?: string; role: 'user' | 'admin'; payouts: { connected: boolean; chargesEnabled: boolean } };
}

export interface MarketInstalled {
  slug: string;
  version: number;
  installedAt: string;
  /** From the account's library, when signed in. */
  skill?: MarketSkill;
  latestVersion?: number;
  updateAvailable: boolean;
  /** Set when moderators took the skill down: uninstall it. */
  removed?: string;
}

export interface MarketCheckReport {
  verdict: 'pass' | 'review' | 'block';
  reason: string;
  static: { rule: string; title: string; severity: 'block' | 'review' | 'info'; file: string; line: number; excerpt: string }[];
  ai?: { verdict: 'pass' | 'review' | 'block'; risk: string; summary: string; findings: { file: string; category: string; severity: string; quote: string; explanation: string }[] };
  aiError?: string;
  aiSkipped?: string;
}

export interface MarketPublishResult {
  skill: MarketSkill;
  version: number;
  verdict: MarketCheckReport['verdict'];
  /** live: published now · pending: a moderator decides · rejected: will not be published */
  state: 'live' | 'pending' | 'rejected';
  report: MarketCheckReport;
}

export interface MarketOwnSkill {
  skill: MarketSkill;
  latest: { version: number; verdict: string; reviewStatus: 'pending' | 'approved' | 'rejected'; reason?: string; createdAt: string } | null;
  earningsCents: number;
  sales: number;
}

/** Skills that are tools rather than editing styles. */
export const UTILITY_SKILLS = ['cutroom:save-style', 'cutroom:save-brand', 'cutroom:elevenlabs', 'cutroom:generate', 'cutroom:sound-effects', 'cutroom:cutout'];

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
  /** Social analytics: how Claude may use the signed-in TikTok and Instagram browser. */
  social: SocialSettings;
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

/** What is connected, for the first-run guide and the chat. */
export interface Brain {
  /** Something can run the editor: Claude (sign-in or API key), or the provider of the chosen model. */
  ready: boolean;
  /** Another provider with models is connected, so a different model could be chosen. */
  alternatives: boolean;
  /** Any account at all is connected. */
  any: boolean;
}

/** A newer release of Cutroom on GitHub. */
export interface Update {
  version: string;
  /** The version that is running. */
  current: string;
  /** The release notes (markdown); may be empty. */
  notes: string;
  /** The installer, or the release page. */
  url: string;
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
  /** Styles and moves the user picked for this request (skill ids). */
  skills?: string[];
  /** On a reply: the edit as it was before Claude started, so the step can be taken back. */
  before?: Timeline;
  /** On a reply: the last entry of this turn in Claude's session, where a split from here branches off. */
  uuid?: string;
  error?: boolean;
}

/** A kept state of the edit: one of Claude's steps, or an export. */
export interface Version {
  id: number;
  /** ISO time. */
  at: string;
  /** What led to it: the user's request, or "Export". */
  label: string;
  timeline: Timeline;
  /** Project-relative path of the exported video, for exports. */
  file?: string;
  final?: boolean;
}

/** Where a file that the user did not shoot came from, and what may be done with it. */
export interface LedgerEntry {
  /** Project-relative path. */
  file: string;
  /** A link, a creator, or the model that generated it. */
  source: string;
  license?: string;
  note?: string;
}

/** The written plan for the video. `pending` = written or changed since the last edit, so it awaits approval. */
export interface Script {
  text: string;
  pending: boolean;
  /** The speech-only cut is ready and waits for approval before visuals are added. */
  spokenCut: boolean;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; text: string }
  | { type: 'done'; error?: string; uuid?: string };

/** One version of a logo drawn in the logo studio. */
export interface LogoDraft {
  version: number;
  svg: string;
  /** What this version is, in Claude's words. */
  note: string;
  at: string;
}

/** Whether a font family is free to download (Google Fonts or Fontsource), and similar names if it is not. */
export interface FontLookup {
  found?: { family: string; weights: number[]; license: string; library: string; category: string };
  suggestions: string[];
  /** The suggestions start with free look-alikes of a well-known paid typeface. */
  lookalikes?: boolean;
}

/** The cuts of the open project and the one being worked on. */
export interface Cuts {
  cuts: Cut[];
  active: string;
}

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
  /** The open project's cuts (one chat and edit each). */
  cuts(): Promise<Cuts>;
  /** Work on another cut: its chat, edit and preview. */
  switchCut(id: string): Promise<Cuts>;
  /** A new, empty chat on the same footage. */
  newCut(name: string): Promise<Cuts>;
  /** Branch the active cut after reply `message` (an index into its chat) into a new cut, and switch to it. */
  splitCut(message: number, name: string): Promise<Cuts>;
  renameCut(id: string, name: string): Promise<Cuts>;
  /** Give the active cut a brand kit ('' = none). Claude is told with the next message. */
  setCutBrand(brand: string): Promise<Cuts>;
  /** Moves the cut's folder to the Trash. The last cut cannot be removed. */
  deleteCut(id: string): Promise<Cuts>;
  loadChat(): Promise<ChatMessage[]>;
  saveChat(messages: ChatMessage[]): Promise<void>;
  send(text: string, marks: Mark[], files: string[], skills: string[]): Promise<void>;
  getScript(): Promise<Script>;
  /** The user accepts the speech-only cut; Claude may add visuals. */
  approveSpokenCut(): Promise<void>;
  /** The user approved a script that still has to be recorded (no edit follows yet). */
  approveScript(): Promise<void>;
  /** Every kept state of the edit, oldest first. */
  versions(): Promise<Version[]>;
  /** Mark a version as the final one (or clear the mark). */
  markFinal(id: number): Promise<Version[]>;
  /** Where everything the user did not shoot came from. */
  ledger(): Promise<LedgerEntry[]>;
  stop(): Promise<void>;
  /** Render the cut to exports/. Resolves with the project-relative path; progress arrives on the 'export' channel. */
  exportVideo(): Promise<string>;
  reveal(path: string): Promise<void>;
  closeProject(): Promise<void>;
  forgetProject(root: string): Promise<Project[]>;
  listSkills(): Promise<Skill[]>;
  revealSkill(id: string): Promise<void>;
  /** Star or unstar a style or move. */
  toggleFavorite(id: string): Promise<Skill[]>;
  /** The style's SKILL.md. */
  readSkill(id: string): Promise<string>;
  /** Rewrite one of the user's own styles. */
  saveSkill(id: string, text: string): Promise<Skill[]>;
  /** Take a video off a style's examples. An exported video stays where it is; the saved example goes to the Trash. */
  removeExample(id: string, file: string): Promise<Skill[]>;
  /** Moves a saved style to the Trash. */
  deleteSkill(id: string): Promise<Skill[]>;
  // Brand kits
  listBrands(): Promise<BrandKit[]>;
  createBrand(name: string): Promise<BrandKit>;
  saveBrand(kit: BrandKit): Promise<BrandKit>;
  /** Moves the kit's folder to the Trash. Chats that used it go on without one. */
  deleteBrand(id: string): Promise<BrandKit[]>;
  /** Opens a file dialog and copies the chosen files into the kit (saving it). */
  addBrandFiles(kit: BrandKit, slot: BrandSlot): Promise<BrandKit>;
  /** Takes a file out of the kit (saving it); the file goes to the Trash. */
  removeBrandFile(kit: BrandKit, slot: BrandSlot, file?: string): Promise<BrandKit>;
  /** The kit's Claude chat. Replies stream on 'brand-agent'; kits Claude changes arrive on 'brand'. */
  brandChat(id: string): Promise<ChatMessage[]>;
  /** `files`: attachment names from brandChatAttach. */
  brandChatSend(id: string, text: string, files: string[]): Promise<void>;
  /** Attach brand guideline PDFs, reference videos or pictures (a file dialog opens without `paths`); resolves with their names. */
  brandChatAttach(id: string, paths?: string[]): Promise<string[]>;
  brandChatStop(): Promise<void>;
  /** A new conversation about the kit; the kit stays as it is. */
  brandChatReset(id: string): Promise<void>;
  /** One of the kit's images as a data: URL, for the logo editor. */
  readBrandImage(id: string, file: string): Promise<string>;
  /** Lift the subject of an image off its background with Apple Vision; resolves with a PNG data: URL. */
  liftImage(dataUrl: string): Promise<string>;
  /** Save an edited logo (PNG bytes) into a slot. */
  saveLogo(kit: BrandKit, slot: LogoSlot, png: Uint8Array): Promise<BrandKit>;
  revealBrand(id: string): Promise<void>;
  // Logo studio: a chat in which Claude draws the kit's logo as SVG.
  logoChat(id: string): Promise<ChatMessage[]>;
  /** Replies stream on 'logo-agent', new versions arrive on 'logo-draft', kit changes on 'brand'. */
  logoChatSend(id: string, text: string, files: string[]): Promise<void>;
  logoChatStop(): Promise<void>;
  /** A new conversation; the versions stay. */
  logoChatReset(id: string): Promise<void>;
  logoChatAttach(id: string, paths?: string[]): Promise<string[]>;
  logoDrafts(id: string): Promise<LogoDraft[]>;
  /** Put a version into a logo slot (SVG plus a PNG beside it). */
  useLogoDraft(id: string, version: number, slot: LogoSlot): Promise<BrandKit>;
  /** Is this family a free font? */
  lookupFont(family: string): Promise<FontLookup>;
  /** Download the role's family and weight into the kit (free fonts only) and save it. */
  fetchFont(kit: BrandKit, role: 'heading' | 'body'): Promise<BrandKit>;
  /** Save the kit as brand guidelines (PDF or Markdown) or as a brand package (.zip) that Cutroom can import. Null if cancelled. */
  exportBrand(kit: BrandKit, format: 'pdf' | 'md' | 'zip'): Promise<string | null>;
  /** Open a file this session exported, or show it in Finder. */
  openExport(file: string, reveal?: boolean): Promise<void>;
  /** A new kit from a brand package (.zip) or a kit's brand.json (a dialog opens without `file`). Null if cancelled. */
  importBrand(file?: string): Promise<BrandKit | null>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  claudeStatus(): Promise<ClaudeStatus>;
  /** Opens Terminal on the official `claude auth login`. */
  claudeLogin(): Promise<void>;
  /** Codex is reached through Claude Code; sign-in is OpenAI's own browser login. */
  codexStatus(): Promise<ClaudeStatus>;
  codexLogin(): Promise<ClaudeStatus>;
  /** Whether a model is connected that can answer in the chat (of the open project, if any). */
  brain(): Promise<Brain>;
  /** Looks on GitHub for a newer release. Null when up to date or unreachable. */
  checkUpdate(): Promise<Update | null>;
  /** Opens the download of that release in the browser. */
  downloadUpdate(): Promise<void>;
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
  // Skill Marketplace
  marketAccount(): Promise<MarketAccount>;
  /** Opens the browser for Google sign-in; resolves once the app is signed in. */
  marketLogin(): Promise<MarketAccount>;
  marketLogout(): Promise<MarketAccount>;
  /** Point the app at another marketplace server ('' = the default). Signs out. */
  marketSetServer(url: string): Promise<MarketAccount>;
  /** Open a page of the marketplace website in the browser, e.g. `/account/payouts`. */
  marketOpenWeb(route: string): Promise<void>;
  marketBrowse(query: MarketQuery): Promise<MarketPage>;
  marketDetail(slug: string): Promise<MarketDetail>;
  /** Install or update; resolves with the library including it. */
  marketInstall(slug: string): Promise<Skill[]>;
  /** Remove from this Mac; `forget` also removes it from your marketplace library. */
  marketUninstall(slug: string, forget?: boolean): Promise<Skill[]>;
  marketInstalled(): Promise<MarketInstalled[]>;
  marketFavorites(): Promise<MarketSkill[]>;
  marketSetFavorite(slug: string, on: boolean): Promise<void>;
  marketReview(slug: string, rating: number, body: string): Promise<MarketReview[]>;
  marketDeleteReview(slug: string): Promise<MarketReview[]>;
  marketReport(slug: string, reason: string, details: string): Promise<void>;
  /** Opens Stripe Checkout in the browser. */
  marketBuy(slug: string): Promise<void>;
  /** Publish one of your own styles or moves (`my:<name>`). */
  marketPublish(id: string, options: { priceCents?: number; changelog?: string }): Promise<MarketPublishResult>;
  marketMine(): Promise<MarketOwnSkill[]>;
  marketUpdateOwn(slug: string, patch: { price?: number; listed?: boolean }): Promise<void>;
  // Social analytics
  socialStatus(): Promise<SocialStatus>;
  /** Show the social browser on a platform's sign-in page, home or own analytics. */
  socialOpen(platform: SocialPlatform, page: 'login' | 'home' | 'analytics'): Promise<void>;
  /** Encrypt a login with the Keychain-backed key, for signing in again when the session has expired. */
  socialSaveLogin(platform: SocialPlatform, username: string, password: string): Promise<SocialStatus>;
  socialForgetLogin(platform: SocialPlatform): Promise<SocialStatus>;
  /** Sign in with the saved login; resolves once signed in (or when it gave up). */
  socialSignIn(platform: SocialPlatform): Promise<SocialStatus>;
  socialSignOut(platform: SocialPlatform): Promise<SocialStatus>;
  /** Open your own profiles now and note their counts. */
  socialCheckNow(): Promise<SocialStatus>;
  /** Videos in the exports/ folders of recent projects: the ones that can be posted. */
  socialExports(): Promise<ExportedVideo[]>;
  /** The Social chat: Claude drafts captions and proposes posts. Replies stream on 'social-agent'. */
  socialChat(): Promise<ChatMessage[]>;
  socialChatSend(text: string, videos: string[]): Promise<void>;
  socialChatStop(): Promise<void>;
  /** A new conversation; drafts and posts stay. */
  socialChatReset(): Promise<void>;
  /** The user's OK: post this draft with this caption. `manual` stops before the final click, for the user to press Post. */
  socialPost(id: string, caption: string, manual: boolean): Promise<SocialStatus>;
  socialDiscard(id: string): Promise<SocialStatus>;
  /** Bring the Social window to the front, as it is. */
  socialShowWindow(): Promise<void>;
  on(channel: 'social', fn: (status: SocialStatus) => void): () => void;
  on(channel: 'social-agent', fn: (event: AgentEvent) => void): () => void;
  /** A `cutroom://install/<slug>` link was opened: show that skill. */
  on(channel: 'market-open', fn: (slug: string) => void): () => void;
  on(channel: 'agent', fn: (event: AgentEvent) => void): () => void;
  /** A step of the brand kit chat, for kit `kit`. */
  on(channel: 'brand-agent', fn: (payload: { kit: string; event: AgentEvent }) => void): () => void;
  on(channel: 'logo-agent', fn: (payload: { kit: string; event: AgentEvent }) => void): () => void;
  on(channel: 'logo-draft', fn: (payload: { kit: string; draft: LogoDraft }) => void): () => void;
  /** Claude changed a brand kit. */
  on(channel: 'brand', fn: (kit: BrandKit) => void): () => void;
  on(channel: 'script', fn: (script: Script) => void): () => void;
  on(channel: 'timeline', fn: (timeline: Timeline | null) => void): () => void;
  on(channel: 'preview', fn: (state: PreviewState) => void): () => void;
  /** How much of the running export is done, 0–1. */
  on(channel: 'export', fn: (done: number) => void): () => void;
  on(channel: 'media', fn: (files: MediaFile[]) => void): () => void;
  on(channel: 'tools', fn: (tools: ToolStatus[]) => void): () => void;
}
