---
name: save-style
description: Save how the current edit was made to the user's library — as a whole-video style, as single moves (a caption treatment, a transition, a title…), or both. Also saves a move seen in a reference video. Use when the user asks to save, keep or export a style, a move or a technique.
---

# Save to the library

The library holds two kinds of entry, both skills in `<library>/skills/<name>/SKILL.md` (the library folder is named in your instructions):

- a **style** describes a whole video: format, structure, pacing, captions, graphics, sound;
- a **move** is one reusable technique that can be dropped into any video: a caption treatment, a transition, a title animation, a zoom, a sound accent.

**Everything you save is a draft.** Write new entries to `<library>/drafts/<name>/`, never straight into `<library>/skills/`. When your turn ends, the app shows the user every draft with its example and instructions, and they keep or drop each one. Kept drafts move into the library; dropped ones are thrown away. So save everything in one turn and finish your reply. Don't ask which ones to keep: the app asks.

Frontmatter for both:

```
---
name: <short-kebab-case, same as the folder>
kind: style | move
tags: <3–6 comma-separated words people would filter by: captions, transition, title, camera, sound, colour, hook, vertical, product…>
source: "<only for a move learned from someone else's video: creator and link>"
description: "<what it makes or does, and when to use it>"
---
```

Frontmatter is YAML: always put `description` and `source` in double quotes (they often contain `: ` or start with `@`, which breaks it unquoted), and escape any `"` inside them as `\"`.

Write instructions that work on completely different footage: decisions and measurements (shot lengths, sizes, positions, fonts, colours, easing, timing, levels), not this project's content. No project-specific text, file names, people or brands — unless the user says it is for that brand.

## Saving a style

1. Study the finished edit: <workspace>/timeline.json, the graphics in <workspace>/motion/, and the feedback the user gave — what they asked to change is the most valuable part.
2. Pick the name (the user's, if they gave one), lowercase with dashes. If `<library>/skills/<name>/` already exists, pick another name unless the user wants to update that one. The app warns them that keeping the draft replaces it.
3. Write SKILL.md (`kind: style`): Format, Structure, Cutting, Captions, Graphics, Audio, and a "Check before replying" list. Optional: reusable graphics in `templates/` with the wording replaced by placeholders.
4. Run `cutroom style-example <name>`. It keeps the current video as the draft's example; once the user keeps the style, this project's exports are listed under it.
5. **Then split out its moves**: each distinct technique in the edit that would be useful on its own becomes a move (see below), named `<what-it-is>`, not after the style. Usually 2–4, each its own draft. Skip anything already in the library (list `<library>/skills/` first) and anything generic.

## Saving a move

From the user's own edit (they marked a section, or you are splitting a style):
1. Write SKILL.md (`kind: move`): what it is, exactly how to build it, when to use and not use it, one check. 10–20 lines.
2. `cutroom style-example <name> --from <start s> --to <end s>` — keeps that section of the current video as its example. Include a second before and after so the move is seen in context.

From a reference video (someone else's):
1. Look at the section (extract frames) and describe the principle — rhythm, placement, motion, timing — in your own measurements. Never their wording, footage, audio or exact layout.
2. Set `source:` to the creator and link.
3. `cutroom style-example <name> --src references/<file> --from <start s> --to <end s>` — keeps a few seconds of the reference privately, only so the user can see the move when browsing. It is never used in a video.

Finish by telling the user what you drafted: the style and each move by name, one line each. Say the app will now ask which to keep.
