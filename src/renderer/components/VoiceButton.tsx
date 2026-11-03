import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { MAX_VOICE_AUDIO_BYTES } from '@shared/schema/transcripts';
import { api } from '../lib/api';
import { useSettings } from '../lib/resources';
import { errorMessage } from '../state/navigation';

interface Capture {
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  discarded: boolean;
}
const stopTracks = (capture: Capture) => { capture.stream?.getTracks().forEach((track) => track.stop()); capture.stream = null; };
const stopCapture = (capture: Capture) => { if (capture.recorder && capture.recorder.state !== 'inactive') capture.recorder.stop(); stopTracks(capture); };

export function VoiceButton({ onText, label = 'Voice input' }: { onText: (text: string) => void; label?: string }) {
  const { data: settings } = useSettings();
  const [state, setState] = useState<'idle' | 'requesting' | 'listening' | 'transcribing'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(false);
  const current = useRef<Capture | null>(null);
  const callback = useRef(onText);
  useEffect(() => { callback.current = onText; }, [onText]);
  const stop = useCallback((discard = false) => {
    const capture = current.current;
    if (!capture) return;
    capture.discarded = discard;
    stopCapture(capture);
    if (discard) { current.current = null; setState('idle'); }
  }, []);
  useEffect(() => () => {
    const capture = current.current;
    current.current = null;
    if (capture) { capture.discarded = true; stopCapture(capture); }
  }, []);
  useEffect(() => {
    if (state !== 'listening') return;
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stop(true); } };
    window.addEventListener('keydown', escape, true);
    return () => { clearInterval(timer); window.removeEventListener('keydown', escape, true); };
  }, [state, stop]);
  const start = async () => {
    if (!settings || current.current) return;
    const engine = settings.voiceInput.engine;
    const capture: Capture = { recorder: null, stream: null, discarded: false };
    current.current = capture;
    const active = () => current.current === capture && !capture.discarded;
    setState('requesting'); setError(''); setLimit(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Microphone recording is unavailable here. You can keep typing.');
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm'].find((mime) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(mime));
      if (!mimeType) throw new Error('This browser cannot record WebM audio. Use the Cutroom desktop app or keep typing.');
      capture.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!active()) { stopTracks(capture); return; }
      const recorder = new MediaRecorder(capture.stream, { mimeType });
      capture.recorder = recorder;
      const chunks: Blob[] = []; let bytes = 0;
      recorder.ondataavailable = (event) => {
        if (!active() || !event.data.size) return;
        if (bytes + event.data.size <= MAX_VOICE_AUDIO_BYTES) { chunks.push(event.data); bytes += event.data.size; }
        else { setLimit(true); stopCapture(capture); }
      };
      recorder.onstop = () => {
        stopTracks(capture);
        if (!active()) return;
        if (!bytes) { current.current = null; setState('idle'); setError('No audio was recorded. Try again.'); return; }
        setState('transcribing');
        void new Blob(chunks, { type: 'audio/webm' }).arrayBuffer()
          .then((buffer) => active() ? api.invoke('voice.transcribe', { audio: new Uint8Array(buffer), mime: 'audio/webm', engine }) : null)
          .then((result) => { if (result && active()) callback.current(result.text); })
          .catch((r: unknown) => { if (active()) setError(errorMessage(r)); })
          .finally(() => { if (active()) { current.current = null; setState('idle'); } });
      };
      recorder.onerror = () => {
        if (!active()) return;
        capture.discarded = true; stopCapture(capture); current.current = null;
        setError('Recording failed. You can keep typing.'); setState('idle');
      };
      recorder.start(250); setSeconds(0); setState('listening');
    } catch (r) {
      stopTracks(capture);
      if (!active()) return;
      current.current = null; setState('idle');
      setError(r && typeof r === 'object' && 'name' in r && typeof r.name === 'string' && ['NotAllowedError', 'PermissionDeniedError'].includes(r.name) ? 'Microphone access is off. Allow Cutroom in System Settings → Privacy & Security → Microphone, then try again. You can keep typing.' : errorMessage(r));
    }
  };
  return <span className="voice-control"><button className="button quiet-button" disabled={!settings || state === 'requesting' || state === 'transcribing'} aria-label={state === 'listening' ? 'Stop recording' : label} onClick={() => { if (state === 'listening') stop(); else void start(); }}>{state === 'listening' ? <Square size={16} /> : <Mic size={16} />}{state === 'listening' ? `Listening · ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : state === 'transcribing' ? `Transcribing with ${settings?.voiceInput.engine === 'whisper' ? 'Local Whisper' : 'ElevenLabs Scribe'}…` : state === 'requesting' ? 'Requesting microphone…' : label}</button>{state === 'listening' && <button className="button quiet-button" onClick={() => stop(true)}>Discard</button>}{limit && <span className="field-note" role="status">Recording limit reached. Transcribing the recording…</span>}{error && <span className="field-error" role="alert">{error}</span>}</span>;
}
