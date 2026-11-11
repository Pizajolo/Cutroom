// What Cutroom can do, where each capability comes from, and how it is paid for.
// One registry drives Settings, the Features pages and what the agent is told it may use.
import type { Provider, Settings } from './types';

export type Pricing = 'free' | 'subscription' | 'on-demand';

/** Accounts connected with one API key. `llm` = it can also run the editing brain (Anthropic-compatible endpoint). */
export const CONNECTIONS = {
  fal: { label: 'fal.ai', pricing: 'on-demand', where: 'fal.ai › Dashboard › Keys' },
  openrouter: { label: 'OpenRouter', pricing: 'on-demand', where: 'openrouter.ai › Keys', llm: 'https://openrouter.ai/api', models: '~anthropic/claude-sonnet-latest, ~anthropic/claude-opus-latest' },
  alibaba: { label: 'Alibaba Cloud · pay-as-you-go', pricing: 'on-demand', where: 'Model Studio › API keys (Singapore)', llm: 'https://dashscope-intl.aliyuncs.com/apps/anthropic', models: 'qwen3.7-max' },
  alibabaCoding: { label: 'Alibaba Cloud · Coding Plan', pricing: 'subscription', where: 'Model Studio › Coding Plan key', llm: 'https://coding-intl.dashscope.aliyuncs.com/apps/anthropic', models: 'qwen3.7-plus' },
  alibabaToken: { label: 'Alibaba Cloud · Token Plan', pricing: 'subscription', where: 'Model Studio › Token Plan key', llm: 'https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic', models: 'auto' },
  theta: { label: 'Theta EdgeCloud', pricing: 'on-demand', where: 'thetaedgecloud.com › On-demand Model APIs › Access keys' },
} as const satisfies Record<string, { label: string; pricing: Pricing; where: string; llm?: string; models?: string }>;
export type Connection = keyof typeof CONNECTIONS;

/** Stills through the ChatGPT sign-in: Codex's built-in image tool. No API key. */
const CODEX_IMAGE = 'codex:image';

/**
 * Every capability the user can switch on or off. `models` lists where a generated-media
 * feature can come from, as `<connection>:<model id>`; the default is the first one whose account is connected.
 */
export const FEATURES = {
  captions: { label: 'Captions and transcripts', group: 'Editing', via: 'Whisper, on this Mac' },
  motion: { label: 'Titles and motion graphics', group: 'Editing', via: 'HyperFrames and Remotion, on this Mac' },
  references: { label: 'Reference video downloads', group: 'Editing', via: 'yt-dlp, on this Mac' },
  voiceover: { label: 'Voice-over and voice cloning', group: 'Sound', via: 'ElevenLabs' },
  music: { label: 'Generated music', group: 'Sound', via: 'ElevenLabs' },
  sfx: { label: 'Generated sound effects', group: 'Sound', via: 'ElevenLabs' },
  localSfx: { label: 'Simple sound effects', group: 'Sound', via: 'FFmpeg, on this Mac' },
  image: { label: 'Generated stills', group: 'Generated picture', models: ['fal:google/nano-banana-2.1', 'openrouter:openai/gpt-image-2', 'alibaba:wan2.7-image-pro', 'theta:Stable Diffusion XL Turbo', CODEX_IMAGE] },
  edit: { label: 'Stills from a reference image', group: 'Generated picture', models: ['fal:google/nano-banana-2.1/edit', 'openrouter:openai/gpt-image-2', 'theta:Image to Image', CODEX_IMAGE] },
  textToVideo: { label: 'B-roll from text', group: 'Generated picture', models: ['fal:kling/v4/text-to-video', 'openrouter:google/veo-3.1', 'alibaba:wan2.7-t2v', 'theta:Seedance 2.5'] },
  imageToVideo: { label: 'B-roll from an image', group: 'Generated picture', models: ['fal:kling/v4/image-to-video', 'openrouter:google/veo-3.1', 'alibaba:happyhorse-1.1-i2v', 'theta:Seedance 2.5'] },
  lipsync: { label: 'Lip sync (portrait + audio)', group: 'Generated picture', models: ['fal:minimax/h3-max/lip-sync/image-to-video'] },
  cutout: { label: 'Subject cutout', group: 'Generated picture', models: ['fal:lightricks/ltx-2.5/alpha-gen'] },
  codex: { label: 'Codex (second agent)', group: 'Other', via: 'ChatGPT account' },
} as const satisfies Record<string, { label: string; group: string; via?: string; models?: readonly string[] }>;
export type Feature = keyof typeof FEATURES;

export interface FeatureState {
  id: Feature;
  label: string;
  group: string;
  /** Where it runs: a local tool, or `<provider> · <model>`. */
  via: string;
  /** For generated media: the chosen `<connection>:<model>` and the suggestions to pick from. */
  model?: string;
  models?: readonly string[];
  pricing: Pricing;
  /** Switched on in Settings. */
  on: boolean;
  /** Its account is connected (always true for local tools). */
  connected: boolean;
  /** Switched off for the open project only. */
  offHere: boolean;
  /** on && connected && !offHere — what the agent may actually use. */
  active: boolean;
}

const connectionOf = (model: string): Connection => model.slice(0, model.indexOf(':')) as Connection;

/** The state of every feature, given the settings, the project's switched-off list and the Codex sign-in. */
export function featureStates(settings: Settings, offHere: string[], codexSignedIn: boolean): FeatureState[] {
  const eleven = settings.elevenlabs.mode !== 'off' && !!settings.elevenlabs.apiKey;
  return (Object.keys(FEATURES) as Feature[]).map((id) => {
    const feature: { label: string; group: string; via?: string; models?: readonly string[] } = FEATURES[id];
    const saved = settings.features[id];
    const reachable = (m: string): boolean => (m.startsWith('codex:') ? codexSignedIn : !!settings.keys[connectionOf(m)]);
    const model = feature.models && (saved?.model || feature.models.find(reachable) || feature.models[0]!);
    const connection: { label: string; pricing: Pricing } | undefined = model?.startsWith('codex:')
      ? { label: 'ChatGPT (Codex)', pricing: 'subscription' }
      : model ? CONNECTIONS[connectionOf(model)] : undefined;
    const connected = model ? reachable(model) : feature.via === 'ElevenLabs' ? eleven : id === 'codex' ? codexSignedIn : true;
    const on = saved?.on ?? true;
    return {
      id,
      label: feature.label,
      group: feature.group,
      via: model ? `${connection?.label ?? 'Unknown provider'} · ${model.slice(model.indexOf(':') + 1)}` : feature.via!,
      model,
      models: feature.models,
      pricing: connection?.pricing ?? (feature.via?.endsWith('on this Mac') ? 'free' : 'subscription'),
      on,
      connected,
      offHere: offHere.includes(id),
      active: on && connected && !offHere.includes(id),
    };
  });
}

/** Providers that can run the editing brain: the user's own, plus every connected account with an Anthropic-compatible endpoint. */
export function llmProviders(settings: Settings): Provider[] {
  const connected = (Object.keys(CONNECTIONS) as Connection[]).flatMap((id) => {
    const c: { label: string; llm?: string; models?: string } = CONNECTIONS[id];
    if (!c.llm || !settings.keys[id]) return [];
    const models = (settings.llmModels[id] || c.models || '').split(',').map((m) => m.trim()).filter(Boolean);
    return [{ name: c.label, baseUrl: c.llm, apiKey: settings.keys[id], models }];
  });
  return [...settings.providers, ...connected];
}
