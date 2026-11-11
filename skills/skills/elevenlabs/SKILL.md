---
name: elevenlabs
description: Create voice-over, music and sound effects, and clone voices, with the ElevenLabs API. Use when the user asks for narration, a voice, music or sound effects and ELEVENLABS_API_KEY is set.
---

# ElevenLabs audio

Only available when `$ELEVENLABS_API_KEY` is set (the user connects ElevenLabs in Settings). If it is empty, say so instead of trying.

Call the API with curl, save results in `assets/`, then add them to the timeline's `audio`. Always pass `-f` (curl `--fail`) so an error is not saved as an audio file; on failure, re-run without `-o` to read the error message. Never print the key.

```sh
H="xi-api-key: $ELEVENLABS_API_KEY"; API=https://api.elevenlabs.io
```

**Voices (the user's voice library)** — list them first and choose by name; cloned voices have category `cloned`.
```sh
curl -sf -H "$H" $API/v1/voices | jq -r '.voices[] | "\(.voice_id)\t\(.name)\t\(.category)"'
```

**Voice-over**
```sh
curl -sf -H "$H" -H "Content-Type: application/json" -o assets/voiceover.mp3 \
  "$API/v1/text-to-speech/<voice_id>?output_format=mp3_44100_128" \
  -d '{"text": "…", "model_id": "eleven_multilingual_v2"}'
```
Write narration in the language of the video. For timing, generate one file per sentence or paragraph, ffprobe each duration, and cut picture to voice — not the other way round.

**Music** (instrumental unless the user asks for vocals)
```sh
curl -sf -H "$H" -H "Content-Type: application/json" -o assets/music.mp3 \
  $API/v1/music -d '{"prompt": "warm acoustic, 100 bpm, gentle build, no vocals", "music_length_ms": 20000}'
```
Describe genre, tempo, instruments and arc; never name an artist or song to imitate. Make it a little longer than the edit and mix it at 0.1–0.2 under speech.

**Sound effects**
```sh
curl -sf -H "$H" -H "Content-Type: application/json" -o assets/whoosh.mp3 \
  $API/v1/sound-generation -d '{"text": "soft cinematic whoosh", "duration_seconds": 1.5}'
```

**Clone a voice** — only from recordings of the user's own voice, or a voice they confirm they have permission to use. Ask if it is not clear whose voice it is; never clone from `references/`.
```sh
ffmpeg -v error -i raw/<clip> -vn -ac 1 -ar 44100 .cutroom/tmp/sample.mp3   # 1–3 minutes of clean speech
curl -sf -H "$H" $API/v1/voices/add -F "name=<name>" -F "files=@.cutroom/tmp/sample.mp3"   # → voice_id
```
The new voice joins the user's library and works with voice-over above.
