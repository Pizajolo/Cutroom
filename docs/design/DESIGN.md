# Cutroom design

The base implementation specification is **[spec.md](spec.md)**. **[round6.md](round6.md) is authoritative for the chat-first layout, simplified navigation/media, approvals/questions, skills and expanded timeline.** This index preserves the DESIGN.md entry point; do not maintain a second, divergent specification here.

## Direction

A calm macOS editing desk: neutral graphite/slate surfaces, system sans typography, muted media-type colours, steel-blue direct selection and dashed amber agent-change review. The video is the colourful object; the interface stays quiet. Lucide icons and system fonts work offline.

Chat stays left of Preview; a single right panel contains Media/Inspector/Audio/Transcript. The eight-track timeline spans below them. Review viewport1440×900, rail56px, chat380px, right panel300px, timeline396px. See round6.md for compact rules. Direct changes are instant and undoable. Agents' changes are already live: Keep acknowledges, Revert uses targeted conflict-aware inverse operations.

## Handoff

| File | Purpose |
|---|---|
| [round6.md](round6.md) | Current chat-first shell, single Media panel, decision cards, Skills, timeline features, compact rules and authoritative shortcut changes |
| [mockups/round6.html](mockups/round6.html) | Current editing desk at desktop, compact and reading widths |
| [mockups/round6-chat.html](mockups/round6-chat.html) | Clarifying questions, permission exceptions, rights, compact review and video types |
| [mockups/round6-timeline.html](mockups/round6-timeline.html) | Group move/snap, track lock, invalid placement and export/progress references |
| [spec.md](spec.md) | Base principles, screens/states, interactions and keyboard map; apply round6 overrides first |
| [components.md](components.md) | Clip/track/playhead/ruler, controls, overlays, messages, progress; dimensions, states, keyboard and accessibility |
| [tokens.css](tokens.css) | Design token mirror; dark and system-light colours, type, spacing, geometry, motion, layers, timeline values |
| `src/renderer/styles/tokens.css` | Same custom-property declarations, ready for renderer import |
| [mockups/index.html](mockups/index.html) | Editor, media bin, selected title, Inspector and populated eight-track timeline |
| [mockups/timeline.html](mockups/timeline.html) | Transcript, word timing, marked range and caption trim gesture |
| [mockups/assistant.html](mockups/assistant.html) | Selection context, live request changes, Keep/Revert and chat composer |
| [mockups/export.html](mockups/export.html) | Export setup; choose Export video or Progress to see static rendering state |
| [settings-connections.md](settings-connections.md) | Accounts, secure key forms, Claude Terminal sign-in, automatic tool/model downloads and live status; supersedes older auth/install wording |
| [round5.md](round5.md) | Usable-project supplement: five settings sections, Codex read-only CLI connection, new/create-in-place projects, Folder root and Home Start; supersedes the team wizard for this round |
| [mockups/settings-workspace.html](mockups/settings-workspace.html) | Five settings pages, MCP edit/review, exact-file cleanup, snapshot restore and preset form |
| [mockups/projects.html](mockups/projects.html) | Recents, new project, plain-folder confirmation, Folder root and Home composer excerpts |
| [mockups/codex-signin.html](mockups/codex-signin.html) | OpenAI method selection, Codex Terminal waiting/detected states and read-only scope |
| [mockups/accounts.html](mockups/accounts.html) | Accounts form, saved key and unreachable provider states |
| [mockups/accounts-signin.html](mockups/accounts-signin.html) | Claude Terminal handoff, waiting and detected sign-in states |
| [mockups/tools.html](mockups/tools.html) | Tool verification, retry, build prerequisite and model download states |
| [validation.md](validation.md) | Browser review, iterations, measured token contrast and limitations |

Frontend first milestone: spec §§1–8. Later screen details: §§9–14. Keyboard map: §15. Do not use the mockup markup or sample values as production data/state logic.

## Decisions requiring no further product choice

- S splits at playhead; C activates Cut tool; V activates Selection.
- Snapping8 screen px; N toggles, held⌘ bypasses.
- Ripple delete affects its track only, not all tracks.
- Fixed row order is not compositing order: B-roll renders above Video.
- Source imports copy/clone by default; Move requires confirmation.
- Display money as **API-equivalent estimate** and unavailable usage as unavailable.
- Chat is a dedicated left column, not an Inspector tab. One Media panel owns all media/folder browsing.
- Auto-approve defaults on for enabled tools; rights, forced overwrites and skill-save confirmations still ask. Question cards never auto-answer.

No open visual/product questions for the planner. Remaining availability and capability questions (tool versions, provider metadata, font acquisition, platform signing) are implementation gates, not permission to display mock success.
