import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import type { Transcript } from '@shared/schema/transcripts';

const offsets = z.object({ from: z.number().nonnegative(), to: z.number().nonnegative() });
const outputSchema = z.object({ result: z.object({ language: z.string() }).optional(), transcription: z.array(z.object({ text: z.string(), offsets, tokens: z.array(z.object({ text: z.string(), p: z.number().min(0).max(1), offsets: offsets.optional() })).optional() })) });
/** whisper.cpp output_json: offsets are milliseconds; token p is probability, not log probability. */
export function parseWhisper(value: unknown): { language: string; words: Transcript['words'] } {
  const parsed = outputSchema.parse(value); const words: Transcript['words'] = [];
  for (const segment of parsed.transcription) {
    const tokens = segment.tokens?.filter((token) => token.offsets && token.offsets.to >= token.offsets.from && !/^\[_.*_\]$|^<\|.*\|>$/.test(token.text.trim())) ?? [];
    if (!tokens.length) { const text = segment.text.trim(); if (text && segment.offsets.to >= segment.offsets.from) { if (/\s/.test(text)) throw new IpcFailure({ code: 'invalid_request', message: 'Whisper did not return word timing. Update whisper-cli in Tools and retry.' }); words.push({ text, start: segment.offsets.from / 1000, end: segment.offsets.to / 1000 }); } continue; }
    let current: { text: string; start: number; end: number; probabilities: number[] } | undefined;
    const flush = (): void => { if (current?.text.trim()) words.push({ text: current.text.trim(), start: current.start, end: current.end, confidence: current.probabilities.reduce((sum, value) => sum + value, 0) / current.probabilities.length }); current = undefined; };
    for (const token of tokens) {
      if (/^\s/.test(token.text) && current) flush();
      if (!current) current = { text: '', start: token.offsets!.from / 1000, end: token.offsets!.to / 1000, probabilities: [] };
      current.text += token.text; current.end = Math.max(current.end, token.offsets!.to / 1000); current.probabilities.push(token.p);
    }
    flush();
  }
  if (words.some((word, index) => word.end < word.start || (index > 0 && word.start < words[index - 1]!.start))) throw new IpcFailure({ code: 'invalid_request', message: 'Whisper returned invalid word timestamps.' });
  return { language: parsed.result?.language ?? 'auto', words };
}
export const whisperArgs = (model: string, wav: string, output: string): string[] => ['-m', model, '-f', wav, '-l', 'auto', '-ojf', '-ml', '1', '-sow', '-of', output];
