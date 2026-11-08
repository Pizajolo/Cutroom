# Design validation

Reviewed in the available Chromium browser on 2026-11-01. These are static design references, not an Electron/runtime acceptance test.

## Browser review

Opened and inspected screenshots of:
- `mockups/index.html` at 1440×960: editor, selected title, media bin, Inspector and all eight tracks.
- `mockups/timeline.html` at 1440×960: transcript, caption word controls, range and trim readout.
- `mockups/assistant.html` at 1440×960: context, dashed agent highlights, property differences, Keep/Revert and composer.
- `mockups/export.html` at 1440×960: settings and the `#rendering` progress state. Clicking Export video correctly changes the static state; no real render is started.
- Main editor at 1024×680: sidebar rail, media bin collapsed, timeline vertically scrollable, preview/transport still visible. Inspector content scrolls independently.
- Main editor with light token declarations applied in-browser at 1440×960: light chrome, dark preview mat and corresponding clip treatments.

Iterations from screenshot review:
1. Fixed preview sizing to preserve 16:9 under both width and height constraints (measured 1.777 aspect, rather than stretching it).
2. Wrapped track names to avoid truncating Overlays/Motion and Video (main).
3. Corrected waveform CSS specificity, then reduced waveform height to keep labels readable above it.
4. Reduced assistant content spacing to keep both review actions visible above the sticky composer.
5. Added compact-height timeline scrolling; retained accessible sidebar labels when visual text collapses.
6. Fixed light-mode filmstrip labels to remain light on their dark backing and added a darker waveform asset.
7. Aligned timeline default to 396 px and export width/preset column to 720/200 px in docs and mockups.

Final recheck after these changes: screenshots confirmed the complete assistant review card is visible, the narrower export settings layout fits, and light-mode filmstrip labels and waveforms remain legible. Geometry checks confirmed no horizontal document overflow, a fully visible assistant review card, and a 396 px timeline token. Browser console reported no new errors in the reviewed session. Original SVG storyboard art, waveform assets and icon sprite load locally without network or fonts.

## Token contrast measurements

WCAG relative-luminance contrast formula, calculated in-browser from CSS custom-property values (sRGB linearisation). Text measurements use app, panel, raised-panel and hover backgrounds. These are token-pair checks, **not a complete WCAG conformance audit** of the future application or arbitrary footage.

| Pair / minimum across stated backgrounds | Dark | Light |
|---|---:|---:|
| Primary text | 9.91:1 | 12.13:1 |
| Secondary text | 6.20:1 | 6.26:1 |
| Muted supporting text | 4.77:1 | 4.90:1 |
| Primary button text / accent fill | 9.06:1 | 6.70:1 |
| Focus ring / panel | 9.99:1 | 6.51:1 |
| Minimum media clip text / its solid fill | 7.15:1 | 7.01:1 |

All measured normal-text pairs exceed AA 4.5:1; measured focus indicator pairs exceed 3:1. Disabled text is intentionally not part of this claim and must not carry essential instructions. Preview content needs its own contrast/review checks; chrome tokens cannot guarantee readability over any video frame.

The final comparison confirmed custom-property declarations in `docs/design/tokens.css` and `src/renderer/styles/tokens.css` are equivalent, including `--timeline-height: 396px`; comments/whitespace differ.

## Accounts/tools repair design review (2026-11-01)

New references consume the actual renderer tokens and `app.css`, rather than a divergent mockup-only component theme:

- `mockups/accounts.html`: screenshot-reviewed at 1440×960 and 390×844, with an additional layout snapshot at 1024×768; three provider states (disconnected, saved key, temporarily unreachable). The narrow layout keeps the password input and Connect usable without horizontal page/card overflow.
- `mockups/accounts-signin.html`: screenshot-reviewed at 1440×960 in both waiting-in-Terminal and `#detected` states. Clicking the reference link changes the static state. Detected sign-in retains Not connected until the explicit Use this sign-in action; mockup controls never launch Terminal.
- `mockups/tools.html`: screenshot-reviewed at 1440×960 and 1024×768, including verified tool, indeterminate verification, failed download/Retry, build-only whisper-cli and determinate base-model progress. Lower model/default/Remotion content scrolls within Settings; at compact desktop widths the table has its own horizontal scroll region.
- Accounts light theme screenshot-reviewed by applying existing light token declarations in-browser, not by changing macOS appearance.

Iterations: corrected inline SVG viewBoxes (the neutral circle was clipped); restored left-aligned settings links when the global sidebar becomes a rail; separated wrapping compact navigation from reference notes; added zero minimum content width and bounded compact rows; darkened progress tracks from border-strong to bg-hover so fill/track contrast exceeds 3:1. Final screenshot confirmed the lighter filled portion is clearly distinguished from its track.

Browser measurements (WCAG luminance formula):

| Pair | Dark | Light |
|---|---:|---:|
| Connected text / status background | 7.26:1 | 6.05:1 |
| Unreachable text / status background | 7.09:1 | 5.55:1 |
| Invalid text / status background | 7.00:1 | 5.54:1 |
| Supporting text / card background | 6.13:1 | 5.62:1 |
| Progress fill / track | 6.62:1 | 5.59:1 |
| Focus ring / card background | 9.99:1 | 6.51:1 |

Keyboard Tab inspection confirmed Connect has a 2 px focus ring and 2 px offset. At 390 px, document width remained 390 px, content scroll width matched client width (334 px), and no card overflowed. Tool progress elements measured 4 px high: verifying omitted aria-valuenow, while base download exposed value 64 plus phase/byte description. The reviewed browser console had no new errors.

These are static design and CSS checks only. No real provider keys were entered, no Terminal login or Keychain operation was run, no binaries/models were downloaded, and no npm/typecheck/runtime suite was run in this design step. The existing Electron app status was failed (exit 134 from an earlier backend-dev launch); the local static-reference server was used for visual review. Functional account/installer acceptance belongs to frontend/backend/QA, not these mockups.

## Usable-project/settings supplement review (2026-11-02)

Added `round5.md` and three new offline HTML references sharing existing renderer tokens and component CSS. No production application logic, account credentials or token values changed.

Browser screenshots reviewed:

- `mockups/settings-workspace.html`: Sandbox and Extensions at 1280×800; MCP edit → review link flow and review screenshot at 1280×800; Voice input and Render presets at 1024×768; exact-file cleanup confirmation at 1024×768. Storage and Voice input also reviewed at 390×844. All five sections are switchable through fragment links.
- MCP review and the plain-folder project confirmation at 390×844: text/commands wrap, safe actions remain visible. The MCP dialog measured 356 px client/scroll width, with footer bottom 741 px inside an 844 px viewport.
- `mockups/projects.html`: recent/missing/current projects, New project and Create a project in this folder at 1280×800; Folder root and Home composer excerpts at 1440×960. Home and Folder root are explicitly labelled excerpts, not additional production modal designs. No native folder dialog or filesystem write occurs.
- `mockups/codex-signin.html`: waiting-in-Terminal and detected-but-not-enabled states at 1440×960; separate Claude primary-connection and OpenAI API-key statuses remain visible. The static Use this sign-in button doesn't enable anything.

Iterations from review: corrected the settings-fragment selector specificity so selected sections actually appear; kept the relevant settings page behind its review modal; preserved the 24 px inset when navigating to a section anchor; corrected a missing icon reference; made the custom-server summary match its command review; restored the stacked Whisper model label/select after a more specific radio-label flex rule overrode it. Final narrow Voice screenshot confirms the stacked model field.

Geometry check at 390×844 for all five settings sections plus extension edit/review, cleanup, restore and preset dialogs: document scroll width 390 px; settings client/scroll widths both 334 px. No horizontal page/content overflow in those states. Automated DOM checks found no missing local fragment targets or icon symbols across the three new HTML files. Browser console reported no new errors. Existing semantic colour tokens/contrast measurements above continue to apply; this is not a new comprehensive accessibility audit. Native modal focus trapping, IPC correctness, provider status, keyboard shortcuts and live services remain implementation/QA checks, not claims made by static mockups.

Attempted `app_start` before review. The app exited 127: `sh: electron-vite: command not found` in this designer worktree. Used the tool's working-folder HTTP server for the static references instead. No dependency installation, npm/typecheck/lint/unit suite, native login, microphone capture, Keychain change, media operation or live MCP connection was performed in this design step.

## Chat-first supplement review (2026-11-08)

Current handoff: round6.md and its component overrides. Added three static offline references importing production tokens directly: round6.html, round6-chat.html and round6-timeline.html (including #export / #rendering).

Browser review and measurements:

- Main desk screenshot-reviewed at1440×900,1120×800,1024×680 with Media open, and390×844 reading layout. Additional1280×800 snapshot/geometry check. Document scroll widths exactly1440/1280/1120/1024/390 respectively; no horizontal document overflow. Upper columns measured380/704/300 at1440,380/544/300 at1280,320/472/272 at1120 and320/368/280 at1024 with Media open. Composer remained within the upper region at every measured desktop size. At1024 Media starts closed and the visible Media link opens the single dock via a static fragment.
- Preview corrected after first screenshot to constrain both axes without cropping the output frame; measured width/height ratio1.7779 at1440,1120 and1024. Reduced sample transcript length so the compact review card is visible at1440; shorter-height streams intentionally scroll independently from the composer.
- Chat decisions screenshot-reviewed at1440×900 and390×844: options, explicit Other input, permission session action, rights exception, review details and video types. Iterated Other visibility to follow the selected radio and illustrated a free-text45-second answer. Real requests start unselected; the mockup explicitly labels its preselected illustration. Native Tab from Other reached its input; computed focus outline2px solid rgb(175,215,255), offset2px.
- Timeline group-move/snap/locked and invalid-placement reference screenshot-reviewed at1440×900. Corrected sample group delta and In/Out band geometry to match labels. Export settings screenshot-reviewed at1440×900 and390×844; narrow dialog width342px, inner scrollWidth340px, footer bottom756px in844px viewport. Export video switches to the static rendering view; narrow rendering screenshot also reviewed. No actual render is started.
- Added a compact Close panel link and removed secondary preview size metadata in compact widths so the actual controls remain legible. In production use the specified focus restoration, not fragment navigation.

Contrast rechecked in-browser from the actual dark tokens: primary/panel12.74:1, secondary/panel7.97:1, muted/panel6.13:1, muted/raised5.51:1, button text/accent9.06:1, focus/panel9.99:1, necessary input border/input3.62:1. No colour values changed; existing system-light token checks remain applicable. This is a token-level check, not full application WCAG certification. Browser-fetched normalized custom-property declarations in docs/design/tokens.css and src/renderer/styles/tokens.css were equivalent after the additive geometry update. Browser console reported no new messages in the reviewed session.

Attempted app_start before review; it exited1 with ERR_MODULE_NOT_FOUND for vite in this designer worktree. Used the browser tool's working-folder HTTP server for static references. No dependency installs, product logic changes, npm/typecheck/lint/unit suite, actual Whisper build/transcription, IPC, permission response or native dialog operations were run. Runtime approval/gating, keyboard editing, splitter persistence and service acceptance remain frontend/backend/QA gates.

## Limits and implementation follow-through

- Mockups are static HTML/CSS, with real links between the four references and CSS-target switching for Export. Many controls illustrate appearance and intentionally do not edit media or run jobs. Sample usage, amounts, times and completed checks are fictional design content.
- Production uses Lucide React rather than treating the mockup's small illustrative SVG symbol sheet as a new icon library.
- Mockups force dark for deterministic review. Production does not: tokens follow system `prefers-color-scheme`. Light values were inspected by applying the light rule set, not by changing macOS settings.
- Historical references retain the former dock layouts. Current production handoff is round6.md: persistent left chat, one right Media/Inspector/Audio/Transcript panel, nonmodal beside-preview compact dock. Do not implement a canvas-covering sheet from the older notes.
- Keyboard/focus/ARIA requirements are documented for implementation; static visual controls are not evidence those behaviours pass production tests.
- No npm, Electron, rendering, media-import or application test suite was run in this design-only step. Those are separate developer/QA gates.
