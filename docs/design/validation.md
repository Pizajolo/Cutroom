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

## Limits and implementation follow-through

- Mockups are static HTML/CSS, with real links between the four references and CSS-target switching for Export. Many controls illustrate appearance and intentionally do not edit media or run jobs. Sample usage, amounts, times and completed checks are fictional design content.
- Production uses Lucide React rather than treating the mockup's small illustrative SVG symbol sheet as a new icon library.
- Mockups force dark for deterministic review. Production does not: tokens follow system `prefers-color-scheme`. Light values were inspected by applying the light rule set, not by changing macOS settings.
- The compact reference retains a pinned Inspector. Production follows spec §2 for a dismissible upper-workspace sheet below 1120 px, with preview/timeline unobscured when it is closed.
- Keyboard/focus/ARIA requirements are documented for implementation; static visual controls are not evidence those behaviours pass production tests.
- No npm, Electron, rendering, media-import or application test suite was run in this design-only step. Those are separate developer/QA gates.
