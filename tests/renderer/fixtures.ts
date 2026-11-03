import { TRACK_KINDS, type TimelineDoc } from '@shared/schema/timeline';
import type { ProjectSession } from '@shared/schema/project';
import type { MediaFile } from '@shared/schema/media';
import { defaultGlobalSettings } from '@shared/schema/settings';
export const session: ProjectSession = {
  rootPath: '/fixture/coast', looseMediaCount: 1,
  project: { id: 'coast', name: 'Coast', format: { aspect: '16:9', width: 1920, height: 1080, fps: 30 }, defaultEngine: 'hyperframes', createdAt: '2026-11-01T00:00:00.000Z', folderMap: { raw: 'raw', references: 'references', assets: 'assets', compositions: 'compositions', audio: 'audio', work: 'work', final: 'final' } },
};
export function timelineDoc(): TimelineDoc {
  return { version: 1, format: session.project.format, markers: [], tracks: TRACK_KINDS.map((kind) => ({ id: kind, kind, name: kind, muted: false, solo: false, items: kind === 'video' ? [{ id: 'clip_0000000001', type: 'clip', src: 'raw/coast.mp4', start: 0, duration: 5, in: 2, out: 7, speed: 1, volume: 1, muted: false, createdBy: 'user', userEdited: [] }] : [] })) };
}
export const media: MediaFile = { rel: 'raw/coast.mp4', name: 'coast.mp4', kind: 'video', url: 'http://127.0.0.1:1234/k/fixture/p/coast/raw/coast.mp4', probe: { duration: 12.51, width: 1920, height: 1080, fps: 30, vcodec: 'h264', acodec: 'aac', channels: 2, sampleRate: 48000, bitrate: 1000000, size: 1000000, hasAlpha: false } };
export const preset = { id: 'draft', name: 'Draft 720p', builtin: true, container: 'mp4' as const, vcodec: 'h264' as const, crf: 23, size: { width: 1280, height: 720 }, fit: 'fit' as const, fps: 'project' as const, audio: { codec: 'aac' as const, loudnessLufs: -14, truePeakDb: -1 } };
export function defaultReply(channel: string): unknown {
  switch (channel) {
    case 'app.getInfo': return { version: '0.1.0', platform: 'darwin', arch: 'arm64', homeDir: '/fixture', mediaBaseUrl: null, compBaseUrl: null };
    case 'settings.get': return defaultGlobalSettings();
    case 'project.current': return null;
    case 'project.listRecent': case 'jobs.list': case 'extensions.list': case 'audio.voices': case 'tools.list': case 'models.list': case 'accounts.list': case 'media.list': case 'snapshots.list': return [];
    case 'timeline.get': case 'timeline.apply': case 'timeline.undo': case 'timeline.redo': return { doc: timelineDoc(), revision: 1, canUndo: true, canRedo: false };
    case 'export.presets': return [preset];
    case 'export.preflight': return { canExport: true, blockers: [], unsupportedItems: [] };
    case 'media.thumbnails': return { imageRel: 'work/thumbs.jpg', imageUrl: 'http://127.0.0.1:1234/thumbs.jpg', interval: 1, frameWidth: 160, frameHeight: 90, columns: 1, rows: 1, count: 1, frames: [{ time: 0, x: 0, y: 0, w: 160, h: 90 }] };
    case 'transcripts.get': return null;
    case 'audio.estimate': return { credits: null };
    default: return { ok: true };
  }
}
