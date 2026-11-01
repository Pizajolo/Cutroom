# Cutroom design

The complete implementation specification is **[spec.md](spec.md)**. This index preserves the DESIGN.md entry point; do not maintain a second, divergent specification here.

## Direction

A calm macOS editing desk: neutral graphite/slate surfaces, system sans typography, muted media-type colours, steel-blue direct selection and dashed amber agent-change review. The video is the colourful object; the interface stays quiet. Lucide icons and system fonts work offline.

Preview sits above an eight-track timeline. Media/Transcript share the left dock; Inspector/Audio/Assistant share the right dock. Default window1440×960, timeline396 px. Compact layouts collapse navigation and docks before sacrificing the timeline. Direct changes are instant and undoable. Agents' changes are already live: Keep acknowledges, Revert uses targeted conflict-aware inverse operations.

## Handoff

| File | Purpose |
|---|---|
| [spec.md](spec.md) | Principles, exact window/dock sizes, all screens/states, interactions, full keyboard map and acceptance checklist |
| [components.md](components.md) | Clip/track/playhead/ruler, controls, overlays, messages, progress; dimensions, states, keyboard and accessibility |
| [tokens.css](tokens.css) | Design token mirror; dark and system-light colours, type, spacing, geometry, motion, layers, timeline values |
| `src/renderer/styles/tokens.css` | Same custom-property declarations, ready for renderer import |
| [mockups/index.html](mockups/index.html) | Editor, media bin, selected title, Inspector and populated eight-track timeline |
| [mockups/timeline.html](mockups/timeline.html) | Transcript, word timing, marked range and caption trim gesture |
| [mockups/assistant.html](mockups/assistant.html) | Selection context, live request changes, Keep/Revert and chat composer |
| [mockups/export.html](mockups/export.html) | Export setup; choose Export video or Progress to see static rendering state |
| [settings-connections.md](settings-connections.md) | Accounts, secure key forms, Claude Terminal sign-in, automatic tool/model downloads and live status; supersedes older auth/install wording |
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
- Assistant replaces Inspector at normal window sizes; optional extra dock only on large screens.

No open visual/product questions for the planner. Remaining availability and capability questions (tool versions, provider metadata, font acquisition, platform signing) are implementation gates, not permission to display mock success.
