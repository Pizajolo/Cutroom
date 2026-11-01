export function formatTimecode(seconds: number, fps: number): string {
  const nominal = Math.round(fps);
  const frames = Math.max(0, Math.round(seconds * fps));
  const totalSeconds = Math.floor(frames / nominal);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}.${String(frames % nominal).padStart(2, '0')}`;
}

/** Non-drop frame timecode; fractional fps uses the actual frame index. */
export function parseTimecode(value: string, fps: number): number | null {
  const match = /^(\d+):([0-5]\d)\.(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const frames = Number(match[3]);
  const nominal = Math.round(fps);
  if (frames >= nominal) return null;
  return ((Number(match[1]) * 60 + Number(match[2])) * nominal + frames) / fps;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
