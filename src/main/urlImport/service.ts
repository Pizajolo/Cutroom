import { z } from 'zod/v3';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { IpcFailure, type InvokeReq } from '@shared/ipc/contract';
import { importUrlSchema, urlMetadataSchema, type UrlMetadata } from '@shared/schema/urlImport';
import { appendJson, managedPath } from '../fs/managed';
import { importPaths } from '../media/import';
import type { MediaService } from '../media/service';
import type { WorkflowRuntime } from '../projects/runtime';
import { runCommand, type RunCommand } from '../process/run';

export function validImportUrl(value: string): string {
  const parsed = importUrlSchema.safeParse(value); if (!parsed.success) throw new IpcFailure({ code: 'invalid_url', message: 'Enter an HTTP(S) video URL without credentials.' }); return parsed.data;
}
export interface DownloadProgress { bytes: number; total: number | null; rate: number | null; eta: number | null }
export function parseDownloadProgress(line: string): DownloadProgress | null {
  const parts = line.trim().split('|'); if (parts.length !== 7 || parts[0] !== 'CUTROOM') return null;
  const numeric = (value: string | undefined): number | null => value && value !== 'NA' && value !== 'None' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const bytes = numeric(parts[1]); if (bytes === null) return null;
  return { bytes, total: numeric(parts[2]) ?? numeric(parts[3]), rate: numeric(parts[4]), eta: numeric(parts[5]) };
}
export const downloadArgs = (url: string, formatId: string, temporary: string, ffmpeg: string): string[] => [
  '--ignore-config', '--no-playlist', '--no-warnings', '--no-overwrites', '--newline', '--progress',
  '--progress-template', 'download:CUTROOM|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|end',
  '--ffmpeg-location', ffmpeg, '-f', formatId, '-o', path.join(temporary, '%(title).120B [%(id)s].%(ext)s'), '--', validImportUrl(url),
];
const metadataSchema = z.object({ title: z.string().default('Imported video'), uploader: z.string().nullish(), duration: z.number().nonnegative().nullish(), thumbnail: z.string().nullish(), formats: z.array(z.object({ format_id: z.string(), format: z.string().optional(), ext: z.string().optional(), width: z.number().finite().nonnegative().nullish(), height: z.number().finite().nonnegative().nullish(), fps: z.number().finite().nonnegative().nullish(), vcodec: z.string().optional(), acodec: z.string().optional(), filesize: z.number().nonnegative().nullish(), filesize_approx: z.number().nonnegative().nullish() })).default([]) });
export function mapUrlMetadata(value: unknown): UrlMetadata {
  const info = metadataSchema.parse(value);
  return urlMetadataSchema.parse({ title: info.title, uploader: info.uploader ?? '', durationSec: info.duration ?? 0, thumbnailUrl: importUrlSchema.safeParse(info.thumbnail).success ? info.thumbnail : null, formats: [{ id: 'bestvideo*+bestaudio/best', label: 'Best available', ext: 'mp4' }, ...info.formats.filter((format) => format.ext && (format.vcodec !== 'none' || format.acodec !== 'none')).map((format) => ({ id: format.format_id, label: format.format ?? format.format_id, ext: format.ext!, ...(format.width ? { width: Math.round(format.width) } : {}), ...(format.height ? { height: Math.round(format.height) } : {}), ...(format.fps ? { fps: format.fps } : {}), ...(format.vcodec ? { vcodec: format.vcodec } : {}), ...(format.acodec ? { acodec: format.acodec } : {}), ...((format.filesize ?? format.filesize_approx) !== undefined && (format.filesize ?? format.filesize_approx) !== null ? { approxBytes: Math.round((format.filesize ?? format.filesize_approx)!) } : {}) }))] });
}
function downloaderFailure(stderr: string): IpcFailure {
  return /unsupported url|no suitable extractor/i.test(stderr) ? new IpcFailure({ code: 'unsupported_site', message: 'This video site is not supported by the installed yt-dlp. Check for an update in Settings → Tools.' }) : new IpcFailure({ code: 'network', message: 'The video could not be fetched. Check the URL, network connection, and whether the video is public.' });
}
export class UrlImportService {
  constructor(private readonly options: { runtime: WorkflowRuntime; media: MediaService; resolveTool: (name: string) => Promise<string>; run?: RunCommand }) {}
  async fetch(url: string): Promise<UrlMetadata> {
    validImportUrl(url); const binary = await this.options.resolveTool('yt-dlp'); let stderr = '';
    const result = await (this.options.run ?? runCommand)(binary, ['--ignore-config', '-J', '--no-playlist', '--no-warnings', '--skip-download', '--', url], { timeoutMs: 60_000, maxOutputBytes: 16 * 1024 * 1024, onStderr: (chunk) => { stderr = (stderr + chunk).slice(-8192); } }).catch(() => { throw new IpcFailure({ code: 'network', message: 'Video metadata could not be fetched. Check the connection and yt-dlp installation.' }); });
    if (result.code !== 0) throw downloaderFailure(stderr);
    try { return mapUrlMetadata(JSON.parse(result.stdout)); } catch { throw new IpcFailure({ code: 'unavailable', message: 'yt-dlp returned invalid video metadata. Update it in Settings → Tools.' }); }
  }
  async download(request: InvokeReq<'urlImport.download'>): Promise<{ jobId: string }> {
    validImportUrl(request.url); if (request.rightsConfirmed !== true) throw new IpcFailure({ code: 'forbidden', message: 'Confirm you have permission to download this video.' });
    const project = this.options.runtime.projects.require(); const [binary, ffmpeg] = await Promise.all([this.options.resolveTool('yt-dlp'), this.options.resolveTool('ffmpeg')]);
    const metadata = await this.fetch(request.url); const confirmedAt = new Date().toISOString();
    if (this.options.runtime.projects.current()?.project.id !== project.project.id) throw new IpcFailure({ code: 'conflict', message: 'The project changed. Retry the download.' });
    return this.options.runtime.jobs.enqueue(project, 'url_import', `Download · ${metadata.title}`, async (context) => {
      const base = await managedPath(project.rootPath, 'work/downloads'); await mkdir(base, { recursive: true, mode: 0o700 }); const temporary = await mkdtemp(path.join(base, `${context.id}-`)); let stderr = ''; let tail = '';
      try {
        const result = await (this.options.run ?? runCommand)(binary, downloadArgs(request.url, request.formatId, temporary, ffmpeg), { signal: context.signal, timeoutMs: 24 * 3_600_000, onStdout: (chunk) => {
          tail += chunk; const lines = tail.split(/\r?\n/); tail = lines.pop()!.slice(-16384);
          for (const line of lines) { const progress = parseDownloadProgress(line); if (progress) context.progress(progress.total ? Math.min(0.9, progress.bytes / progress.total * 0.9) : 0.05, `Downloading · ${progress.bytes} bytes${progress.rate ? ` · ${Math.round(progress.rate)} B/s` : ''}`, progress.eta ?? undefined); }
        }, onStderr: (chunk) => { stderr = (stderr + chunk).slice(-8192); } });
        if (result.code !== 0) throw downloaderFailure(stderr); context.signal.throwIfAborted();
        const entries = await readdir(temporary, { withFileTypes: true }); const files = entries.filter((entry) => entry.isFile() && /\.(mp4|mov|mkv|webm|m4a|mp3|wav|ogg|flac|aac)$/i.test(entry.name));
        if (files.length !== 1) throw new IpcFailure({ code: 'unavailable', message: 'The downloader did not produce one complete media file.' });
        context.progress(0.95, 'Importing download');
        const [rel] = await importPaths(project.rootPath, [path.join(temporary, files[0]!.name)], request.destination, { signal: context.signal, firstSuffix: 2 });
        await appendJson(project.rootPath, '.cutroom/provenance.jsonl', { url: request.url, title: metadata.title, rel, confirmedAt, formatId: request.formatId });
        this.options.media.notify([rel!]); return { rel };
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
  }
}
