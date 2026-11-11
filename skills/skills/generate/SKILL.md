---
name: generate
description: Generate stills and b-roll, lip-synced talking video, and subject cutouts (background removal) with AI models on fal.ai, including camera and lens presets for cinematic prompts. Use when the footage has a gap, the user asks for a generated shot, image, talking head, or to cut a person out of their background, and FAL_KEY is set.
---

# AI generation

Your instructions list the user's model for each task as `<provider>:<model>`; only those tasks are available. If a task is missing, say that it can be switched on in Settings instead of trying another way. Generation costs the user money and takes minutes: generate what the script calls for, one shot at a time, and never batches of variations unless asked.

Every model takes different inputs, so always check first:

```sh
cutroom generate --schema <provider>:<model>                 # the inputs it takes
cutroom generate <provider>:<model> '<json input>' <out>     # run it and save the result
```

- `fal:` — the JSON is the model's input object (see its schema).
- `openrouter:` — the JSON is the request body without `model`: `{"prompt": …, "aspect_ratio": …}`.
- `alibaba:` — the JSON is `{"input": {…}, "parameters": {…}}`.
- `theta:` — no command: use the mcp__theta tools to list models, run inference and fetch the result, then download the file into the project with curl.

Any project file named in the JSON (`"image_url": "assets/portrait.png"`) is sent along automatically. Save results to `assets/`, named for what they show (`assets/broll-city-night.mp4`). Then look at the result (extract frames and Read them) before putting it on the timeline — regenerate if it has artefacts.

## Stills and b-roll

- **Still:** the image model with a prompt. Match the video's aspect ratio. With a reference image, use the edit model.
- **B-roll from text:** the text-to-video model. Shortest duration that covers the gap (usually 3–5 s).
- **B-roll from an image:** generate or pick a still first, then animate it with the image-to-video model. This gives far more control over composition than text alone — prefer it. A frame from the user's own footage is a good start image when the b-roll must match it.
- Put b-roll on the timeline as an overlay so the main track's sound continues underneath. Grade it to match the footage around it.
- Never generate real people, brands or anything from `references/`. Generated shots support the user's footage; they don't replace it unless the user asks.

## Writing the prompt: camera and lens presets

Describe the shot like a cinematographer: **subject + action, setting, light, camera, lens, movement, look.** Pick one option from each line below that suits the video, and keep the same camera, lens family and look for every generated shot in a video so they cut together. The user may also name them directly ("anamorphic, slow push-in").

| | Presets (use the wording in the prompt) |
| --- | --- |
| **Camera** | *digital cinema camera, full-frame* (clean, modern) · *Super 35 digital cinema* (classic film/TV look) · *large-format digital* (shallow, immersive) · *70mm film* (epic, fine grain) · *16mm film* (grainy, documentary, nostalgic) · *handheld smartphone* (casual, social) |
| **Lens** | *vintage prime* (soft, warm flares) · *modern prime* (crisp, neutral) · *anamorphic* (oval bokeh, horizontal flares, wide feel) · *macro* (extreme close detail) · *tilt-shift* (miniature effect) · *telephoto* (compressed background) · *wide-angle* (space, energy) |
| **Focal length** | *14mm* ultra-wide · *24mm* wide · *35mm* natural · *50mm* portrait-natural · *85mm* portrait, compressed · *135mm* tele close-up |
| **Aperture** | *f/1.4* very shallow depth of field, creamy background · *f/4* subject sharp, soft background · *f/11* everything in focus |
| **Movement** | *locked-off tripod* · *slow push-in* · *pull-back reveal* · *pan* · *tilt* · *tracking shot alongside* · *orbit around the subject* · *crane up* · *handheld, slight shake* · *drone fly-over* · *FPV dive* · *dolly zoom* |
| **Light** | *golden hour* · *soft overcast* · *window light* · *high-key studio* · *low-key, single source* · *neon at night* · *backlit, rim light* |

Example: *"A barista pours latte art, close on the cup, warm café interior, window light. Super 35 digital cinema, vintage prime 50mm at f/1.4, slow push-in, shallow depth of field, soft warm grade."*

## Lip sync

The lip-sync model turns a portrait image plus an audio file into a talking video.
1. Audio: the user's recording, or a voice-over made with the elevenlabs skill.
2. Image: a still the user provides, or a clean front-facing frame from their footage.
3. Run the model, check frames and that the length matches the audio, then place it as a clip (or picture-in-picture overlay) with its own sound (`volume: 1`).
Only for the user themselves or people they confirm have agreed. Say clearly in your reply that the shot is AI-generated.

## Subject cutout

The cutout model removes the background from a video and returns a file with transparency.
- Input: a clip, trimmed first with ffmpeg to just the part you need (`.cutroom/tmp/`), to save time and cost.
- Ask for the `.mov` output (`<out>` ending in `.mov`): it carries the alpha channel. Save it in `.cutroom/motion/`.
- Use it as an overlay: over a new background clip or image, over graphics, or with a title placed *between* the background and the cutout (title overlay first, cutout overlay after it) for the text-behind-subject effect.
- For green-screen footage no model is needed: set `"key": "#00ff00"` on the overlay.
