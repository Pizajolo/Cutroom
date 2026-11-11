---
name: sound-effects
description: Make simple sound effects locally with FFmpeg (click, pop, whoosh, impact, riser, ding) and place them on the timeline. Free, no account. Use when a cut, title or moment needs an accent and simple sound effects are available.
---

# Simple sound effects, made locally

Synthesize each effect into `assets/sfx/` and put it on the timeline as an audio item.

```sh
mkdir -p assets/sfx
# click — UI tap, caption word, small cut accent
ffmpeg -v error -y -f lavfi -i "sine=f=1800:d=0.03" -af "volume=5,afade=t=out:st=0.005:d=0.025" assets/sfx/click.wav
# pop — an element appears
ffmpeg -v error -y -f lavfi -i "aevalsrc='sin(2*PI*(500-1500*t)*t)*exp(-35*t)':d=0.15" assets/sfx/pop.wav
# whoosh — a transition or fast move (peak at 0.38 s: put that on the cut)
ffmpeg -v error -y -f lavfi -i "anoisesrc=d=0.6:c=pink:a=0.8" -af "highpass=f=400,lowpass=f=5000,afade=t=in:d=0.38:curve=qua,afade=t=out:st=0.4:d=0.2" assets/sfx/whoosh.wav
# impact — a title lands, a hard cut
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.65*sin(2*PI*55*t)*exp(-7*t)+0.25*(random(0)*2-1)*exp(-40*t)':d=0.7" assets/sfx/impact.wav
# riser — builds into a reveal (ends at 1.5 s: put the end on the reveal)
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.4*sin(2*PI*(200+500*t*t)*t)*min(1\,t/1.5)':d=1.5" -af "afade=t=out:st=1.45:d=0.05" assets/sfx/riser.wav
# ding — a point made, a tick, a notification
ffmpeg -v error -y -f lavfi -i "aevalsrc='0.5*sin(2*PI*1320*t)*exp(-6*t)+0.25*sin(2*PI*2640*t)*exp(-9*t)':d=0.9" assets/sfx/ding.wav
```

Vary them to suit the video: frequency for pitch, `d` and the `exp(-N*t)` decay for length, filters for tone (a darker whoosh: `lowpass=f=2000`).

## Placing them

- Sparse and motivated: accent the few moments that matter (a title landing, the one big transition, the reveal). Never every cut.
- Time each to the frame of the event; for whoosh and riser, line up the peak or the end, not the start.
- Speech stays dominant: `volume` 0.2–0.5 under a voice, up to 0.8 on its own. Listen to the mix by checking levels (`ffmpeg -i .cutroom/preview.mp4 -af volumedetect -f null -`): no clipping.
- When cuts move, move the effects with them.
- Record them once in the sources list: `cutroom ledger assets/sfx --source "Made locally with FFmpeg" --license "Own work"`.
