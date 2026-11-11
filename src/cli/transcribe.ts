// Word-level transcription with whisper.cpp.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HOME, run } from './run';

export const WHISPER_MODEL = path.join(HOME, 'models/ggml-base.bin');

interface Word {
  start: number;
  end: number;
  text: string;
}

/** Transcribe a media file. Writes `.cutroom/transcripts/<name>.json` and returns a readable transcript. */
export async function transcribe(root: string, src: string, language = 'auto'): Promise<string> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'cutroom-'));
  try {
    const wav = path.join(tmp, 'audio.wav');
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', path.resolve(root, src), '-vn', '-ac', '1', '-ar', '16000', wav]);
    // `-ml 1 -sow` makes whisper emit one segment per word, which gives us word timestamps.
    await run('whisper-cli', ['-m', WHISPER_MODEL, '-f', wav, '-l', language, '-ml', '1', '-sow', '-oj', '-of', path.join(tmp, 'out'), '-np']);
    const raw = JSON.parse(await readFile(path.join(tmp, 'out.json'), 'utf8')) as {
      transcription: { offsets: { from: number; to: number }; text: string }[];
    };
    const words: Word[] = raw.transcription
      .map((w) => ({ start: w.offsets.from / 1000, end: w.offsets.to / 1000, text: w.text.trim() }))
      .filter((w) => w.text);

    // Group words into sentences: split on end punctuation or a pause.
    const segments: Word[] = [];
    let current: Word | null = null;
    for (const w of words) {
      if (current && w.start - current.end < 0.7) {
        current.text += ` ${w.text}`;
        current.end = w.end;
      } else {
        current = { ...w };
        segments.push(current);
      }
      if (/[.!?]$/.test(w.text)) current = null;
    }

    const file = path.join(root, '.cutroom/transcripts', `${path.basename(src, path.extname(src))}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    // One entry per line: easy for the agent to grep and read in slices.
    const rows = (items: Word[]): string => `[\n${items.map((w) => JSON.stringify(w)).join(',\n')}\n]`;
    await writeFile(file, `{"src": ${JSON.stringify(src)},\n"segments": ${rows(segments)},\n"words": ${rows(words)}}\n`);
    const lines = segments.map((s) => `[${s.start.toFixed(2)}–${s.end.toFixed(2)}] ${s.text}`);
    return `${lines.join('\n')}\n\nWord timestamps: ${path.relative(root, file)}`;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
