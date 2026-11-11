---
name: save-style
description: Save the style of the current edit as a new reusable skill in the user's library. Use when the user likes the result and asks to save, keep or export the style as a skill.
---

# Save the current style as a skill

Turn *how* this video was edited into instructions that will work on completely different footage.

1. **Study the finished edit**: .cutroom/timeline.json, the graphics in .cutroom/motion/, and the feedback the user gave in this conversation — what they asked to change is the most valuable part of the style.
2. **Pick a name**: short kebab-case (use the user's name for it if they gave one). The skill goes in the library folder named in your instructions: `<library>/skills/<name>/SKILL.md`. If that folder already exists, ask before replacing it.
3. **Write SKILL.md** in the same shape as the built-in styles:
   - frontmatter: `name`, and a `description` saying what kind of video it makes and when to use it;
   - Format, Structure, Cutting, Captions, Graphics, Audio, and a "Check before replying" list.
   Describe decisions and measurements — shot lengths, pacing, caption size/position/behaviour, fonts, colours, easing, music level — not this project's content.
4. **Templates** (optional): copy reusable graphics into `<library>/skills/<name>/templates/` with the project's wording replaced by variables or placeholders, and reference them from SKILL.md.

Rules:
- No project-specific text, file names, people or brands — unless the user says the style is for that brand, in which case record its colours, fonts and logo usage.
- If reference videos shaped the style, record the principles learned from them (rhythm, structure, treatment), never their footage, audio, wording or exact layouts.
- Finish by telling the user the style's name and one sentence on what it will do next time.
