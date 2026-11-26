---
name: save-brand
description: Save the look and sound of the current edit — logo, colours, fonts, captions, music, sound effects — as a brand kit the user can pick for other videos, or make one from a brand the user describes. Use when the user asks to save, keep or make a brand kit, brand look or brand style sheet.
---

# Save a brand kit

A brand kit is one folder: `<library>/brands/<id>/` (the library folder is named in your instructions) with a
`brand.json` and the files it names, side by side. `<id>` is short kebab-case (`acme`, `acme-dark`). If the folder
exists, ask before replacing it. The app lists the kit under Home › Brand kits as soon as `brand.json` is written, and the
user can pick it in any chat.

1. Gather it. From this edit: the fonts, colours and sizes in `<workspace>/motion/*/index.html`, the caption treatment,
   the logo and music on the timeline (`<workspace>/timeline.json`), the grade. From a description: design it.
2. Copy the files the kit should keep into its folder with plain names (`logo.png`, `heading.ttf`, `music-1.mp3`), and
   name them in `brand.json` by file name only. Only files the user owns or may reuse: never music or footage from
   references/, never something whose licence in the sources list does not allow it.
3. Write `brand.json` exactly in this shape (every field; `""`, `[]` or `false` when unknown):

```json
{
  "id": "acme",
  "name": "Acme",
  "updatedAt": "<now, ISO>",
  "identity": { "handle": "@acme", "website": "acme.com" },
  "about": "One or two sentences: who the brand is, for whom, how it feels.",
  "logos": { "main": "logo.png", "mark": "icon.png", "onDark": "logo-white.png" },
  "watermark": { "on": false, "logo": "mark", "corner": "top-right", "size": 12, "opacity": 0.85 },
  "endCard": { "on": true, "line": "acme.com" },
  "colors": { "primary": "#1f6feb", "secondary": "#0d1b2a", "accent": "#ffd166", "text": "#ffffff", "background": "#101418" },
  "fonts": {
    "heading": { "family": "Inter", "weight": 800, "file": "heading.ttf" },
    "body": { "family": "Inter", "weight": 600 }
  },
  "sizes": { "title": 7, "caption": 4.5 },
  "captions": { "mode": "speech", "case": "as-spoken", "highlight": true, "outline": false, "shadow": true, "position": "lower-third", "words": 4 },
  "music": { "tracks": ["music-1.mp3"], "mood": "warm, upbeat acoustic", "level": 0.15 },
  "sfx": { "files": [], "amount": "subtle" },
  "look": { "lut": "look.cube", "transitions": "cuts", "energy": "balanced" },
  "copy": { "language": "", "tone": "friendly, direct", "avoid": "", "emoji": false },
  "format": { "aspect": "9:16", "length": 0 },
  "notes": "",
  "layout": {
    "title": { "x": 0.08, "y": 0.14, "w": 0.78, "size": 7, "align": "left", "color": "text", "case": "as-written", "italic": false, "on": true },
    "subtitle": { "x": 0.08, "y": 0.25, "w": 0.78, "size": 3, "align": "left", "color": "text", "case": "as-written", "italic": true, "on": true },
    "caption": { "x": 0.08, "y": 0.6, "w": 0.76, "size": 4.5, "align": "center", "color": "text", "case": "as-written", "italic": false, "on": true },
    "logo": { "x": 0.08, "y": 0.085, "w": 0.12 },
    "handle": { "x": 0.08, "y": 0.5, "size": 2.4, "on": true },
    "platforms": ["tiktok", "reels", "shorts"]
  }
}
```

- `logos` keys are optional (leave out what there is not); `watermark.logo` is `main`, `mark` or `onDark`.
- Sizes are % of the frame height; `watermark.size` is % of the frame width; `opacity` and `music.level` are 0–1.
- `captions.mode`: `speech` | `always` | `off`; `case`: `as-spoken` | `upper` | `lower`;
  `position`: `top` | `middle` | `lower-third` | `bottom`.
- `sfx.amount`: `none` | `subtle` | `lots`; `look.transitions`: `cuts` | `crossfades` | `whips` | `mixed`;
  `look.energy`: `calm` | `balanced` | `punchy`; `format.aspect`: `""` | `9:16` | `16:9` | `1:1` | `4:5`.
- Leave `look.lut` and font `file` out when there is none. Put anything the fields cannot say in `notes`.
- `layout`: where the title, subtitle, captions, logo and handle tag sit in this edit, as fractions of the frame (box
  top-left x, y and width w; size in % of the frame height); measure them from the graphics. Leave it out to use the
  standard layout. Keep everything inside x 0.05–0.85, y 0.11–0.78 so TikTok's, Instagram's and YouTube's buttons and
  text never cover it.

Finish with one line: the kit's name, and that it can be picked with the brand menu at the top of any chat.
