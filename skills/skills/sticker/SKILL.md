---
name: sticker
kind: move
tags: sticker, cutout, overlay, emphasis, playful
description: Sticker: a person or object lifted out of the footage with a white die-cut outline, popping in beside the action. Use to point at a product, react to a line, or build a collage-style intro. Needs cutouts.
---

# Sticker

- Make it with the cutout skill: `cutroom cutout <clip> <workspace>/motion/sticker-<what>.png --at <s> --outline 0.025`. Choose a frame with a clear pose or expression; for a product, a clean packshot from `assets/` works best.
- Size 25–45% of the frame width, in a corner or along an edge that the main subject and the captions leave free. Tilt it 4–8° — never perfectly straight.
- **Pop-in:** one HyperFrames overlay with the PNG (copied into the graphic's folder) as an `<img>`: scale 0 → 1 in 8–10 frames with `back.out(2.2)`, rotation settling from −12° to its resting tilt. It leaves by scaling to 0 in 5 frames, or with the cut.
- If motion graphics are not available, place the PNG directly as an overlay with `fadeIn: 0.08`.
- Hold 1.5–3 s, on screen only while what it shows is being talked about. At most two stickers visible at once, and not on top of faces or captions.
- Pair the pop-in with a "pop" sound if sound effects are available, on the frame it starts.
- Several stickers in a row (a list, a collage): stagger them 150–250 ms, alternate the tilt direction, keep one outline width for all.
- Check a frame at rest: outline unbroken, nothing important covered, the sticker reads at phone size.
