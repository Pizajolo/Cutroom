import { exportPresetSchema, type ExportPreset } from '@shared/schema/export';
import type { GlobalSettings } from '@shared/schema/settings';

const audio = { codec: 'aac', loudnessLufs: -14, truePeakDb: -1 } as const;
const base = { builtin: true, container: 'mp4', vcodec: 'h264', fit: 'fit', size: 'project', fps: 'project', crf: 18, audio } as const;
export const BUILTIN_PRESETS: readonly ExportPreset[] = [
  { ...base, id: 'draft', name: 'Draft · 720p', size: { width: 1280, height: 720 }, crf: 28 },
  { ...base, id: 'final', name: 'H.264 · Project size' },
  { ...base, id: 'hevc', name: 'HEVC', vcodec: 'hevc', crf: 22 },
  { ...base, id: 'prores', name: 'ProRes 422 HQ', container: 'mov', vcodec: 'prores', crf: undefined, bitrateKbps: 220000, audio: { ...audio, codec: 'pcm_s24le' } },
  { ...base, id: 'youtube', name: 'YouTube' },
  { ...base, id: 'reels', name: 'Reels / TikTok', size: { width: 1080, height: 1920 }, fit: 'fill' },
  { ...base, id: 'linkedin', name: 'LinkedIn', size: { width: 1080, height: 1080 } },
].map((preset) => exportPresetSchema.parse(preset));
export function exportPresets(settings: GlobalSettings): ExportPreset[] { return structuredClone([...BUILTIN_PRESETS, ...settings.renderPresets.custom]); }
