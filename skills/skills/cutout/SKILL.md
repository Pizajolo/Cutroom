---
name: cutout
description: Cut the subject (a person, a product, an animal, any object) out of a clip or picture on this Mac, free and without an account - a video with the background gone, or a still sticker. Use for a new background, text behind the subject, a floating product or person, or a sticker, when your instructions say cutouts are made on this Mac.
---

# Cutouts, made on this Mac

```sh
cutroom cutout <in> <out.mov> [--from s] [--to s] [--subject any|person]               # video with the background gone
cutroom cutout <in> <out.png> [--at s] [--subject any|person] [--outline 0.02] [--no-trim]   # still
```

Save results in `<workspace>/motion/`, named for what they show (`<workspace>/motion/cutout-anna-intro.mov`). It is the user's own footage, so no entry in the sources list is needed.

## Video

- `--from` / `--to` are seconds in the source file. Cut out only the part the edit uses: it takes a few seconds per second of video, and the file is large (about 20 MB per second at 720p).
- The result has the size, frame rate and timing of the source, starting at 0. Place it as an overlay with the same `at` and `duration` as the part it covers and leave `x`, `y`, `w` out: a full-frame overlay is stretched to the frame, which lines up exactly with a clip of the same shape underneath.
- If the footage has another shape than the video (landscape footage in a vertical video), or the clip underneath is cropped, give the overlay the `crop` that shows the same part of the picture — for a clip that fills the frame, the centred region with the video's aspect ratio.
- The subject is chosen automatically: the people when someone is in the first frame, otherwise whatever stands out. `--subject person` keeps only people (steadier on talking footage); `--subject any` also keeps what they hold or sit on, and is the one for products and objects.
- Then look at it: put three frames over a strong colour and Read them before using the cutout.
  `ffmpeg -v error -y -f lavfi -i color=c=magenta:s=<w>x<h> -i <cutout.mov> -filter_complex "[0][1]overlay=shortest=1,fps=1,scale=240:-1,tile=3x1" -frames:v 1 <workspace>/tmp/check.jpg`
  Hair, motion blur, glass and a background of the same colour as the subject are where it fails. If the edge flickers or a piece is missing, try the other `--subject`, pick a calmer part of the take, or say so — a cloud model can be chosen for cutouts in Settings › Features.

What it is for:
- **Text behind the subject:** the clip on the main track, the title as an overlay, then the cutout of the same clip as a later overlay, so it sits on top of the title.
- **New background:** the background (clip, image or graphic) on the main track or as a full-frame overlay, the cutout above it. Match the grade of both.
- **Floating subject:** the cutout as a smaller overlay (`x`, `y`, `w`) over other footage, for reactions and picture-in-picture without a box.
- Green-screen footage needs no cutout: set `"key": "#00ff00"` on the overlay.

## Still

- From a picture, or from one frame of a video with `--at <seconds in the source>`. Pick a sharp frame where the subject is whole and not blurred.
- The result is trimmed to the subject; `--no-trim` keeps the full frame so it lines up with the footage (for a freeze frame with the background replaced).
- `--outline 0.02` adds a white die-cut rim, 2% of the sticker's size (0.015–0.04 looks right). See the sticker move for how to use it.
- The command prints the size in pixels: use it to keep the aspect ratio when placing (`w` is a fraction of the frame width; the height follows).
