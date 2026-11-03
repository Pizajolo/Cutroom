import { z } from 'zod/v3';
import { IpcFailure } from '@shared/ipc/errors';
import type { AudioGenerateRequest, AudioVoice } from '@shared/schema/audio';
import type { Transcript } from '@shared/schema/transcripts';

const voicesSchema = z.object({ voices: z.array(z.object({ voice_id: z.string(), name: z.string().optional(), preview_url: z.string().url().nullish(), labels: z.record(z.string()).optional() })), has_more: z.boolean(), next_page_token: z.string().nullish() });
const speechSchema = z.object({ language_code: z.string(), words: z.array(z.object({ text: z.string(), start: z.number().nullish(), end: z.number().nullish(), type: z.string(), logprob: z.number().optional() })) });
export class ElevenLabsClient {
  constructor(private readonly options: { key: () => Promise<string | null>; connected: () => boolean; fetch?: typeof fetch }) {}
  async requireConnected(): Promise<string> { if (!this.options.connected()) throw new IpcFailure({ code: 'invalid_request', message: 'Connect ElevenLabs in Settings → Accounts first.' }); const key = await this.options.key(); if (!key) throw new IpcFailure({ code: 'invalid_request', message: 'Reconnect ElevenLabs in Settings → Accounts first.' }); return key; }
  private async request(endpoint: string, init: RequestInit, signal?: AbortSignal): Promise<Uint8Array> {
    const key = await this.requireConnected(); const combined = AbortSignal.any([AbortSignal.timeout(5 * 60_000), ...(signal ? [signal] : [])]);
    try {
      const response = await (this.options.fetch ?? fetch)(`https://api.elevenlabs.io${endpoint}`, { ...init, redirect: 'error', headers: { ...init.headers, 'xi-api-key': key }, signal: combined });
      if (!response.ok) { await response.body?.cancel(); throw new IpcFailure({ code: 'unavailable', message: response.status === 401 || response.status === 403 ? 'ElevenLabs rejected this request. Check the account connection and plan permissions.' : response.status === 429 ? 'ElevenLabs is rate-limited or out of credits. Check your plan and retry later.' : `ElevenLabs could not complete the request (HTTP ${response.status}).` }); }
      if (!response.body) throw new Error('Empty response');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 100 * 1024 * 1024) throw new Error('Response limit'); chunks.push(value); } } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (combined.aborted) throw new Error('Interrupted'); const output = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; } return output;
    } catch (error) { if (error instanceof IpcFailure) throw error; throw new IpcFailure({ code: 'unavailable', message: signal?.aborted ? 'ElevenLabs request cancelled.' : 'ElevenLabs is unreachable or returned an invalid response. Check your connection and retry.' }); }
  }
  async voices(signal?: AbortSignal): Promise<AudioVoice[]> {
    const result: AudioVoice[] = []; let token: string | undefined;
    for (let page = 0; page < 100; page++) {
      const data = voicesSchema.parse(JSON.parse(new TextDecoder().decode(await this.request(`/v2/voices?page_size=100${token ? `&next_page_token=${encodeURIComponent(token)}` : ''}`, { method: 'GET' }, signal))));
      result.push(...data.voices.map((voice) => ({ id: voice.voice_id, name: voice.name ?? voice.voice_id, previewUrl: voice.preview_url ?? null, labels: voice.labels ?? {} })));
      if (!data.has_more) return result; if (!data.next_page_token || data.next_page_token === token) throw new IpcFailure({ code: 'unavailable', message: 'ElevenLabs returned invalid voice pagination.' }); token = data.next_page_token;
    }
    throw new IpcFailure({ code: 'unavailable', message: 'The voice library is too large to load in one request.' });
  }
  async generate(request: Exclude<AudioGenerateRequest, { kind: 'isolate' }>, signal?: AbortSignal): Promise<Uint8Array> {
    if (request.kind === 'sfx' && request.durationSec !== undefined && (request.durationSec < 0.5 || request.durationSec > 30)) throw new IpcFailure({ code: 'invalid_request', message: 'Sound effects must be between 0.5 and 30 seconds.' });
    if (request.kind === 'music' && request.durationSec < 3) throw new IpcFailure({ code: 'invalid_request', message: 'Music generation requires at least 3 seconds.' });
    const endpoint = request.kind === 'tts' ? `/v1/text-to-speech/${encodeURIComponent(request.voiceId)}` : request.kind === 'sfx' ? '/v1/sound-generation' : '/v1/music';
    const body = request.kind === 'tts' ? { text: request.text, ...(request.model ? { model_id: request.model } : {}) } : request.kind === 'sfx' ? { text: request.text, ...(request.durationSec !== undefined ? { duration_seconds: request.durationSec } : {}) } : { prompt: request.text, music_length_ms: Math.round(request.durationSec * 1000), model_id: 'music_v1' };
    return this.request(`${endpoint}?output_format=mp3_44100_128`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, signal);
  }
  async isolate(audio: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> { const body = new FormData(); body.set('audio', new Blob([new Uint8Array(audio)]), 'audio.wav'); return this.request('/v1/audio-isolation', { method: 'POST', body }, signal); }
  async transcribe(audio: Uint8Array, model: string, signal?: AbortSignal): Promise<{ language: string; words: Transcript['words'] }> {
    const body = new FormData(); body.set('file', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'audio.wav'); body.set('model_id', model); body.set('timestamps_granularity', 'word');
    const data = speechSchema.parse(JSON.parse(new TextDecoder().decode(await this.request('/v1/speech-to-text', { method: 'POST', body }, signal))));
    return { language: data.language_code, words: data.words.filter((word) => word.type === 'word' && typeof word.start === 'number' && typeof word.end === 'number' && word.start >= 0 && word.end >= word.start).map((word) => ({ text: word.text, start: word.start!, end: word.end!, ...(word.logprob !== undefined && Number.isFinite(word.logprob) ? { confidence: Math.max(0, Math.min(1, Math.exp(word.logprob))) } : {}) })) };
  }
}
