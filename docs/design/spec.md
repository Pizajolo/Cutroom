# Cutroom product and interaction specification

Version 1 · 2026-11-01 · implementation handoff

**Current overrides (2026-11-08): [round6.md](round6.md)** supersedes §2 and conflicting media, timeline, assistant and keyboard details (§§3/5/11/15). Use its chat-first single-screen layout, not the older project-tab/dock mockups below.

**Build order:** §§1–8 are the first renderer milestone. §§9–15 extend the same shell. This is a design target, not a claim that the features already exist. Use real backend capability/status; never make a disabled feature look operational.

Companion files:
- `tokens.css` and `src/renderer/styles/tokens.css`: equivalent public token sets. The renderer file is ready to import; do not overwrite it with a divergent theme.
- `components.md`: dimensions, visual states, focus and accessibility contracts.
- `mockups/index.html`: editor, including timeline and Inspector.
- `mockups/timeline.html`: expanded edit and transcript state.
- `mockups/assistant.html`: agent changes awaiting Keep/Revert.
- `mockups/export.html`: export settings and rendering progress.

## 1. Intent and visual direction

Cutroom is an **editing desk, not a developer dashboard**. The user's footage and the current edit occupy the centre. Agent activity explains decisions without taking over the workspace. No git, pull request, terminal, browser-preview or code-review vocabulary in the editing surface. Team YAML and composition files remain advanced, explicit tools.

### Design plan and review

- Palette: graphite `#191c20` (room), slate `#23272d` (work surfaces), chalk `#e8edf2` (text), steel blue `#9cc8ef` (direct action/selection), muted amber `#e3bf7a` (agent changes), coral `#f0b1a8` (playhead). No decorative chrome gradients.
- Type: macOS system sans at 13 px for working UI, 12 px for dense controls, 11 px for secondary metadata, 18/24 px for dialog/page titles. SF Mono only for timecodes and raw code; tabular system numerals for counts and money. Offline from first launch.
- Layout: contiguous docked surfaces, a preview over a horizontally continuous timeline, clear 1 px dividers instead of floating cards. Left-aligned labels and prose; centred video only. Label/value grids align on consistent columns.
- Signature: **the cut line**. A fine coral playhead crosses a quiet, ruled timeline. Blue solid outlines mean “you selected this”; amber dashed outlines mean “an agent changed this.” Patterns and labels carry meaning as well as colour.
- Icons: Lucide, 16 px, 1.75 stroke, 24/28 px hit targets; 20 px only for major navigation. Original small pixel-art sprites appear only in Studio. No emoji as production icons.

Review against brief: a black dashboard with glowing multicolour agent cards would put the machinery before the film. Removed those cards and glow; changed pure black chrome to a slightly lighter neutral slate so black footage remains identifiable. Kept muted media colours only inside clips. System type is deliberate macOS ergonomics, not a web-brand display treatment. The original scene in the mockups is offline storyboard artwork, not a bundled example movie or evidence of a completed render.

### Principles

1. **The frame is the work.** Keep preview contrast stable; no effects or tinted overlays except explicit selection, safe guides and feedback.
2. **Direct means direct.** Inspector changes never invoke an agent. Show immediate local feedback; commit one history entry per meaningful gesture.
3. **Agents leave an explainable edit.** Show what changed, who changed it, and why. Never disguise a running tool as approval or a failed gate as success.
4. **A timeline, not a workstation course.** Eight fixed tracks; no keyframe graph, nested sequence, multicam or effects-stack UI.
5. **Sources are safe.** Import copies/clones by default. Agents cannot change raw footage, references or supplied assets. Label the actual guarantee, “Read-only for agents,” not “Locked” when the user can still import.
6. **Continuity over spectacle.** Preserve zoom, playhead, selection and scroll when props change. No animated panel entrances during playback.

## 2. Window, navigation and docking

Default new window: **1440 × 960 CSS px**. Minimum supported Electron content area: **1024 × 680**. Restore window bounds and project-local dock sizes on subsequent opens. All measurements exclude the native menu bar.

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ native traffic lights     Cutroom / North coast             jobs  export │ 44
├────────────┬─────────────────────────────────────────────────────────────┤
│ Home       │ Editor   Runs   Media   Backlog   Notes                     │ 40
│ Projects   ├──────────────┬────────────────────────┬─────────────────────┤
│  North…    │ Media        │ Preview                │ Inspector           │
│ Teams      │ Transcript   │                        │ Audio / Assistant   │
│            │              │                        │                     │
│            │ media bin    │ letterboxed canvas     │ selected props      │
│            │ or transcript│                        │                     │
│ Settings   │              ├────────────────────────┤                     │
│ usage      │              │ transport              │                     │
│ jobs       ├──────────────┴────────────────────────┴─────────────────────┤
│            │ tool/selection bar                           zoom    fit     │ 36
│            ├──────────────┬──────────────────────────────────────────────┤
│            │ track labels │ ruler / markers / playhead                    │ 28
│            │ fixed        │ eight scrollable track lanes                  │
│            └──────────────┴──────────────────────────────────────────────┤
│            │ operation/status hint                          duration     │ 24
└────────────┴─────────────────────────────────────────────────────────────┘
```

### Dimensions and resizing

| Region | Default | Min / max | Behaviour |
|---|---:|---:|---|
| Global sidebar | 176 | 176 / 224 | Collapse to 56 px icon rail. Does not cover timeline. |
| Title bar | 44 high | fixed | Native traffic-light inset 78 px; draggable empty area only. All controls `no-drag`. |
| Project tabs | 40 high | fixed | Editor / Runs / Media / Backlog / Notes, in that order. |
| Left editor dock | 224 wide | 192 / 320 | Media / Transcript segmented tabs; can close. Reopen via View menu. |
| Right editor dock | 280 wide | 260 / 400 | Inspector default; Audio and Assistant available as dock tabs. |
| Assistant active | 360 wide | 320 / 480 | Replaces right dock by default. Selection chip opens Inspector without losing chat draft. |
| Preview + transport | remaining | preview min 360 × 200 | Canvas fits actual format; never stretch to fill panel. |
| Timeline | 396 high | 240 / 65% window height | Full project-content width below docks. Horizontal divider changes preview/timeline ratio. |
| Track label column | 148 wide | 136 / 200 | Stays fixed while timeline scrolls horizontally. |
| History / feedback drawer | 320 wide | 280 / 420 | Replaces left dock, not a floating overlay over video. |

Splitter is visually 1 px, hit area 8 px, cursor col/row-resize. Double-click restores default. Keyboard focused splitter: arrows change 8 px, Shift+arrows 32 px. ARIA separator with min/current/max. Do not shift playback clock while resizing.

At ≥1680 px, the user may pin Assistant as an additional 360 px dock to the right of Inspector, but only if preview retains ≥480 px width. At smaller sizes it replaces Inspector. Do not open three narrow competing side panels.

### Compact mode

**Compact accessibility clarification (2026-11-02):** hiding a dock must never remove access to its features. Use **Sources** and **Editor tools** disclosures, not icon-only affordances or CSS-only hiding. This replaces the earlier floating-sheet treatment.

- **≥1280 px:** retain the existing desktop docks and resizing behaviour.
- **1120–1279 px:** use the 56 px global rail; Sources starts closed, the existing 260 px right dock remains open initially. Show both disclosure buttons. Opening Sources temporarily parks the right dock; opening Editor tools parks Sources. At most one compact dock is visible.
- **≤1119 px:** both docks start closed on first compact entry. A disclosure opens one **300 px** dock beside the preview, within the upper workspace only. This is an explicit compact-width exception for Assistant. The preview flexes in the remaining width; the dock never overlays the canvas, transport or timeline. Do not stack the dock above the preview at supported desktop widths: that would consume the limited preview height.
- Put the buttons in a **36 px minimum-height toolbar immediately above the upper workspace**; use existing 28 px controls and 16 px icons. Wrap the toolbar rather than creating horizontal document overflow. Visible labels stay **Sources** / **Editor tools**, with chevron and expanded treatment; do not replace labels with the active tab name.
- Sources contains **Media | Transcript**; Editor tools contains **Inspector | Audio | Assistant**. Remember each group's last active tab (Media / Inspector initially). Panel header includes a 28 px Close button with accessible name **Close sources** / **Close editor tools**. Keep panel header/tabs and Assistant composer available; body scrolls vertically. Never hide overflowed tabs without a scrollable, keyboard-reachable tab strip.
- Disclosures use `aria-expanded` and `aria-controls`; an open dock is a nonmodal `region` labelled **Sources** / **Editor tools**. No backdrop, `aria-modal`, focus trap or background inertness. Opening moves focus to the remembered active tab; native tablist arrows/Home/End select tabs, Tab enters panel content. Preview, transport and timeline remain keyboard reachable. View → Sources / Editor tools provides the same entry points; no new global shortcut.
- Closing returns focus to its disclosure. Escape closes the open compact dock and restores focus **after** any higher-priority recording, menu, dialog or in-progress edit handles Escape; it must not discard a draft. Before a breakpoint hides or parks a panel containing focus, move focus to the corresponding visible disclosure. Hidden/parked panels must not leave focusable descendants in the tab order. Preserve active tab, chat/script/form drafts, scroll, selection, playhead and playback; opening/closing a dock never starts work or sends a message.
- Do not auto-open a dock merely because selection or an assistant event changes. Permission/review work may mark **Editor tools** with a text badge (for example “Needs permission”), but must not steal focus. Explicit actions such as Ask or Home Start may open Editor tools → Assistant.

At 1024×680 upper workspace keeps at least 230 px, timeline is 280 px with vertically scrollable track lanes. Keep the disclosure toolbar reachable and the preview visible, shrinking its letterboxed presentation rather than clipping video. The eight tracks always exist; never silently omit an empty track. Sticky ruler and track headers stay aligned during both scroll axes. Scrollbars are visible while scrolling and on pointer hover; never rely on hidden scrollbar discovery.

The native minimum is desktop-sized. For narrow browser/accessibility reflow (≤700 px), use ≥36 px disclosure targets, keep preview/transport first, and place the one open dock **below** preview in document flow with a maximum 40dvh scrolling body; allow vertical workspace/page scrolling rather than covering the preview or forcing side-by-side horizontal overflow. This reading fallback is not a promise of a mobile editing workspace. Retain the same labels, tabs, close and focus behaviour.

### Navigation details

Sidebar: Home, Projects (disclosure plus recent projects, active project highlighted), Teams, Settings. Bottom: jobs summary, Claude plan compact meter if available, bell with unread badge. Do not fabricate plan usage: “Plan usage unavailable” with explanation when API does not expose it. Settings is one destination, not mixed into the recent list.

Project title bar: breadcrumb/project name, saved/saving status, Undo/Redo, Ask, Export. Saved status refers to confirmed persistence, never merely optimistic state. Tooltips show next Undo/Redo label. Opening a project activates Editor and restores its state. Project tabs preserve panel scroll/selection when switching away.

## 3. Media and empty/import states

### Editor media bin

Header with Media / Transcript tabs. Folder switcher: Footage, References, Assets, Generated audio, Exports (maps respectively to raw/, references/, assets/, audio/, final/; respect folder remapping). Header import button opens Files / URL options. Search filters filenames and known tags; clear affordance is visible when nonempty.

Compact media rows/cards: thumbnail 16:9, filename, duration. Hover exposes Add to timeline and overflow; keyboard context menu exposes the same. Selected media is outlined blue. Double-click opens source playback in preview with a conspicuous “Source” pill; “Back to timeline” returns to timeline clock without losing it. A single click previews metadata, not an unexpected timeline mutation.

### Full Media tab

Toolbar: search, folder filter, grid/list toggle, **Import files**, **Import from URL**. Default grid minimum card width 196 px, 16 px gaps, 16 px page inset. Cards show thumbnail, filename, m:ss duration, resolution, fps, codec, file size. A compact lock icon and text identify the three source folders as read-only for agents. Audio has waveform placeholder, images real thumbnail, unrecognised files type icon. Folder sections can collapse; empty section includes a local import action. Failed thumbnail leaves filename and metadata usable.

Drag from Finder onto Media or empty preview opens a destination confirmation (Footage default); drag onto folder section preselects that destination. Clone/copy is default, never move. Multiple files show total and per-file progress. Do not infer transfer progress from probing progress. Each phase reads “Copying 2 of 6”, then “Preparing thumbnails 2 of 6”. Cancel stops pending transfers and clearly lists completed files. Import failures do not hide successful files.

Media → timeline drag carries a project-relative source. Ghost shows source name, target time and duration. Allowed tracks: video to Video/B-roll; audio to Voiceover/Music/SFX; images to compatible visual track with default 5 s. Composition templates to Overlays/Motion. A source with no known duration must finish probing before timed insertion. Do not create a guessed-length video item.

### State copy

- Empty Home: “Make a video with your team.” Goal box and New project/Open project, no fake runs or spend.
- Empty project: preview says “Bring in footage, or start with an idea.” **Import files**, **Import from URL**, **Describe your video**. Timeline keeps eight named empty lanes and one “Drop clips onto Video” hint, not eight duplicate prompts.
- Loading project: keep shell, small skeleton only in regions with unknown data. Announce loading once, no fake percentage.
- Sources missing: retain the timeline block, hatched thumbnail and “Source missing”. Inspector has **Locate file**; never substitute a different clip automatically.
- Import failed: “Couldn't import C0042.mov. The file could not be read.” **Choose another file**, expandable technical details and **Copy details**. Do not display media access tokens in copied details.

## 4. Preview, selection and direct editing

Panel header: “Preview”, Draft/Live status, format, fit percentage, safe-area toggle, preview options. Content background stays near-black in either theme. Black/silence is the legitimate preview for timeline gaps. Before anything exists show empty state; don't confuse empty with a decode error.

Transport centred below canvas: Previous edit, Play/Pause, Next edit; current and total timecodes; loop toggle, playback quality. Time display uses `m:ss.ff` (frames), with a tooltip showing seconds; fractional frame rates use the project's frame index mapping, not a fabricated integer-fps clock. Numeric times in report links can be decimal seconds. Never mix the two notations unlabelled.

Single clock governs video, audio, captions and composition runtime. Preview can show a small **Approximate colour** badge for unsupported LUT/temperature reproduction; tooltip says “Export uses full colour processing.” No badge claiming “full quality” when approximation is active. A draft render is separate from live playback and identified as such.

### Selection contract

- Click: first hit in visual z-order. Shift-click: toggle additive selection. Escape: clear selection (unless editing text or dismissing a dialog first).
- Z-order top to bottom: **Overlays > Text > Captions > B-roll > Video (main)**. Timeline row order still puts Video before B-roll. Never determine stacking from DOM row index.
- Hover names appear after 400 ms next to the element, not beneath the cursor, with a 300 ms exit delay. Suppress during playback and drags.
- Selected element: 1 px blue bounding box; eight 6 px square handles on a high-contrast backing, each with a ≥16 px pointer hit area. Rotation handle 18 px above top edge. Do not expose a handle unless the underlying prop is declared editable.
- Timeline and preview share selection by stable item id plus optional cutId/wordId. Timeline selection seeks only on double-click or explicit “Go to start”, not ordinary selection.
- Shift-drag paused frame with Area tool makes a normalised rectangle for Ask/feedback, not a crop. Label it “Frame area”. Separate crop controls live in Inspector.
- Double-click text starts in-place editing only when the contract permits it. Enter commits one-line text; Shift+Enter inserts newline where supported. For multiline text Enter inserts newline and ⌘Enter commits. Escape restores pre-edit text. Clear editing affordance and Done button prevent trapping the user.

### Direct changes

Inspector updates locally immediately, while drag/slider/text gesture is in progress. Commit once on pointer release, field blur/Enter or explicit Done. Text fields may debounce 300 ms only when each logical edit is coalesced; never create history for every keystroke. Rejected persistence restores last confirmed value, keeps attempted value in an error affordance, and offers Retry. A short “Saving…” can appear; persistent failure becomes an inline notice, not a vanishing toast.

Drag in preview snaps element anchor to centre and action/title-safe guides within 8 screen px; temporarily bypass with ⌘. Safe guides are 90% action-safe, 80% title-safe in both axes, off by default. Respect declared layout bounds; arrow keys nudge selected element 1 output pixel (Shift = 10) only while preview has keyboard focus. Otherwise arrows step frames.

Selection of multiple elements shows common editable fields; differing values show “Mixed”, not an invented value. Editing a common field changes all selected compatible elements in one atomic operation. Excluded fields explain why. No selection: Inspector shows project format, current time, and a compact selection hint.

## 5. Timeline

### Fixed tracks and default lane sizing

| Row | Visible name | Height | Kind colour / content |
|---:|---|---:|---|
| 1 | Overlays / Motion | 34 | muted violet / engine icon and composition name |
| 2 | Text | 34 | slate blue / first line |
| 3 | Captions | 34 | muted straw / words |
| 4 | Video (main) | 52 | slate teal / filmstrip and filename |
| 5 | B-roll | 52 | slate teal / filmstrip and filename |
| 6 | Voiceover | 42 | muted green / waveform and line label |
| 7 | Music | 42 | muted green / waveform and filename |
| 8 | SFX | 42 | muted green / waveform and label |

Heights total 332 px plus 64 px toolbar/ruler: the default timeline is exactly 396 px, showing all eight tracks at the default window size. Smaller timeline heights scroll the lanes vertically. User can compact lanes (28/40/32) through View menu. Empty lanes retain height. Track headers have icon, name, **M** and **S** toggles. M/S are real toggle buttons with “Mute Music” / “Solo Music” accessible names, not abbreviations alone. Muted tracks dim media but keep labels readable; soloed tracks get outlined S. Muted/silent states use icons too. Track order is fixed; no drag handles implying reorderable tracks.

Timeline toolbar: Selection tool, Cut tool, snapping, Add text, marker/comment, history, current selection summary, zoom − / slider / + / Fit. No giant tool palette. Default zoom 64 px/s; min4/max512. Initial project fit may choose a smaller value if duration exceeds viewport. Fit considers the full edit plus 5% trailing room; it does not change current time. Zoom anchors at playhead when visible, otherwise viewport centre. At 512 px/s allow subsecond ruler ticks. Ruler labels never overlap: minimum spacing 64 px, choose frame/0.5/1/2/5/10/30/60 s intervals appropriate to zoom.

### Clips and gestures

- Visible clip occupies lane minus 4 px top/bottom. 1 px tinted border, 4 px radius; selected blue 2 px inset outline. Title baseline stays at lane top even when waveform/filmstrip visible. Add a dark backing behind text over thumbnails. Colour is not the only media-type indicator.
- Thumbnail tiles crop to the source aspect, never distorted. Waveforms are normalised for display only (not a statement of loudness). Tiny items <24 px show icon only, with tooltip and minimum 8 px hit geometry without falsifying duration.
- Move: 3 px drag threshold, local ghost, original dashed placeholder, floating start/end time readout. Commit exactly once on release. Escape aborts. Pointer capture keeps gesture stable outside viewport; autoscroll within 32 px edge zones.
- Trim: 8 px edge hit area and directional cursor; selected clip reveals 2 px handles. Tooltip shows new boundary and delta. Media in/out clamp to source duration. Composition/text/caption trims alter visible duration, never imply editing source animation curves. Minimum length one output frame.
- Snapping: item starts/ends, playhead, markers and zero within 8 screen px; nearest wins, ties: playhead then item edge then marker. Thin vertical snap guide and label identify target; no sticky snap beyond threshold. Hold ⌘ bypasses; **N** toggles persistent snapping.
- Invalid placement: danger outline and hatched ghost plus “Overlaps Video” or “This track accepts audio”. Original stays put; dropping never silently overwrites.
- Video and Voiceover reject overlaps. Other tracks allow overlaps; vertically offset overlapping blocks within lane enough to expose selection edges, with layer order available in context menu. Array order determines z-order, not start time. “Bring forward/back” edits within-track stacking only, not track order.
- Split selected items at playhead with **S**, only when playhead is strictly inside. No selection: split focused track's item at playhead, if any; no global all-track split. **C** selects the Cut tool, whose click splits the clicked item at that time. **V** returns to Selection. Both call identical split operations.
- Delete leaves gap. Shift+Delete ripple-deletes only within the affected track, shifts later items left by the removed duration, and never silently alters all other tracks. With multiple disjoint selections apply descending-time deletions atomically; label scope in confirmation/context menu. First-use hint: “Ripple affects this track only.” A linked all-track ripple is not in v1.
- Insert gap: context menu at ruler or track, duration dialog and explicit track name; no modal appears on incidental background click.
- Reordering means arranging items in time by moving; **Bring forward/back** is stacking on overlapping tracks. Do not make a sortable list that changes time accidentally.

### Playhead, range, markers

Ruler click seeks; ruler drag scrubs using pointer capture. Content background click selects nothing; it does not seek while the user is starting a marquee. Shift-drag ruler selects an In/Out range; **I/O** set boundaries at playhead, show translucent neutral band and draggable handles. Backward range normalises. Range is context for Ask, loop and export, never an automatic destructive trim. Clear via Option+X or range menu.

Playhead is a 1 px coral line, 9 px head at ruler, 12 px hit area. It overlays clips without blocking their edge handles except at the ruler. During playback autoscroll only when playhead leaves the visible area; no continuous centring that moves the material under the pointer.

**M** adds marker; double-click marker edits label in a small popover. Feedback markers use speech-bubble shape and lilac, plain markers diamond and neutral, reviewer findings warning triangle. Shapes, tooltips and accessible labels distinguish them. Range markers span their actual time.

### History and concurrency

⌘Z/⇧⌘Z use TimelineService history, including props edits. List entries display “You” or member name, label and time. Selecting a history entry previews its affected items; **Restore to here…** confirms how many subsequent changes will be undone, including others' changes. A new edit clears redo; announce once if redo was nonempty.

Conflicting drag/agent change: preserve user's ghost, show “This item changed while you were editing.” **Try again** or **Cancel** after refetch. Never silently move someone else's updated item to stale coordinates. Source files are never rewritten by a timeline gesture.

## 6. Inspector v1 and framework

Right dock header with selected element name and kind; back button for moving from cutId to whole composition. Small **Ask** action is consistently placed in header. Sections use full-width disclosure rows 32 px high, 12 px inset content, labels 12 px, controls 28 px. Scroll content independently; header stays fixed. Persist expanded sections per item kind, not per individual item.

For clip: **Clip** (In, Out, Duration, Speed, mute, volume), **Reframe** (Fit/Fill/Manual; position, scale), **Colour** (exposure/contrast/saturation/temperature/LUT), **Timing**. Numeric values have units and valid ranges from schema; do not invent a generic 0–100 bound. In/out fields validate source bounds. Duration and source out update consistently with speed. Double-click slider value permits typing. Reset icon appears on modified section with accessible label “Reset Clip adjustments”.

For audio: Gain (dB), fade in/out (seconds), timing, mute/track state, generation metadata read-only with Regenerate line when supported. Do not show a non-existent per-item mute if the current schema supports only gain/track mute; explain track state.

Remaining selection types: **Text**, **Style**, **Layout**, **Timing**, **Layer**, **Captions**. See §10. Inspector may edit only declared props. A composition with no editable contract shows “This composition has no editable elements” plus **Ask to make it editable**, not fake controls.

## 7. Export and background jobs

**Export** in project title bar opens a 720 px wide modal (max viewport minus48), 12 px radius. Header “Export video”; project/version line; close button. Left 200 px preset list: Draft, H.264, HEVC, ProRes, YouTube, Reels/TikTok, LinkedIn. Right summary: size/aspect, fps, codec/container, audio target −14 LUFS / −1 dBTP, range (entire edit default or explicit marked range), output folder `final/`. Only expose settings the render API actually supports. Preset's dimension changes are conspicuous; vertical preset on a landscape project must explain “Fits/reframes the current edit; does not create a new layout.”

Output label before render: “Next available version in final/”. Backend claims version atomically; never promise v3 before it does. Existing versions are never overwritten. Estimated size/time only if available; label estimates as such. Footer: **Cancel**, **Export video**. Disabled if timeline is empty, unsupported items are unacknowledged, or a required tool is unavailable. Reason appears beside the button, not tooltip-only.

V1 render limitation is a persistent warning: “Titles, captions and compositions aren't included in this renderer yet.” List affected items with **Return to editor**. Require explicit “Export without these items” acknowledgement. Remove this warning when v2 renderer supports them; do not retain obsolete warnings.

### Rendering state

After start, dialog retains preview thumbnail and output summary, switches to phase list: Preparing compositions → Analysing audio → Encoding → Finishing. Active phase with determinate progress only if measured; otherwise animated activity bar and phase text. Overall % must reflect weighted pipeline progress, not reuse encoding % as whole-run truth. ETA after enough progress; before that “Estimating time…”. Cache summary secondary: “3 compositions reused; 1 updated”. **Cancel render** and **Run in background**. Closing dialog backgrounds a running render, not cancellation.

Cancelled state: “Export cancelled. No new version was saved.” **Export again**, **Close**. If cancellation is pending, say “Stopping export…” until job confirms. Failure: “Export failed during Encoding.” Human-readable cause, Retry, View details; partial file never shown as a successful version.

Success: “Video exported” + confirmed filename, duration, format; **Play video**, **Reveal in Finder**, **Done**. Warnings remain visible. Screen-reader polite announcement once; don't announce every percentage.

### Jobs indicator

Bottom sidebar: spinner/progress ring plus “2 jobs running”; most important active phase on second line. Popover width320, rows64: icon, name, phase, progress and Cancel. Clicking row opens relevant dialog/panel. Completed jobs remain in popover history but summary clears when none active. Quiet completion toast with **View**; failure pinned until acknowledged. Multiple jobs use real concurrency state: queued is labelled Queued, not 0% running.

## 8. Component and accessibility baseline

See `components.md` for the complete matrix. Core requirements:

- System appearance via `prefers-color-scheme`; no default manual selector. Preview retains dark mat. Theme switching does not reset editor state.
- Text uses primary/secondary/muted tokens on app/panel/raised surfaces, all aiming ≥4.5:1 for normal text. Disabled text is exempt and never used for essential hints. Interactive outlines/focus indicators use strong border/focus tokens, ≥3:1 against adjacent surface. Subtle dividers are structural, not the sole affordance of an input.
- Buttons and input boundaries use `--border-strong` where shape is necessary; neutral dividers use subtle. Focus-visible 2 px ring with2 px offset; never remove outline without replacement. Selected and focused are independently distinguishable.
- Keyboard traversal follows sidebar → project tabs → left dock → preview/transport → right dock → timeline toolbar → ruler/track items. F6 cycles workspace regions, Shift+F6 reverses. Use roving tab index inside clip collections and menus, not a tab stop for every ruler tick or waveform sample.
- All icon actions named; current-time values editable through an accessible field, not canvas-only. Timeline has an alternative list/table representation with item name, track, start/end, actions. Trim and move available through Inspector/context actions without pointer use.
- Focus trapped in modal, inert background, Escape closes except while confirmation is required; return focus to invoker. Resizers keyboard-operable. Dialog content scrolls before action footer leaves viewport.
- Reduced motion stops Studio typing loops, decorative spinners may become static progress text, no animated panel transitions. Progress, playhead and video remain functional user-requested motion. Avoid flashing indication.
- Scrubbing reports time on release/keyboard step, not every animation frame. Tool progress announcements throttle to phase changes and coarse milestones.

## 9. URL import and Tools

Import from URL is a 640 px dialog. Initial URL field (full width, paste friendly), destination References default, **Fetch formats**. Accept HTTP(S); validation appears on blur/submit. Fetch state retains URL and has Cancel; failure message offers edit URL / Retry without discarding it.

Fetched state: thumbnail120×68, title, uploader, duration. Quality radio table: Best (recommended), then resolution/fps, container/codecs and approximate size (Unknown if unavailable). Combined audio/video choice described simply; do not expose shell flags. Destination Footage/References/Assets, with actual mapped directory as secondary text. First download rights checkbox, initially unchecked: **“I own this content or have permission to use it.”** Recorded confirmation date available in details; never treat as a guarantee of legality. **Download** disabled until confirmed. Also explain that the URL is sent to the source site. No downloads on paste or on Fetch alone.

Downloading shows filename, bytes/total when available, rate, phase, ETA and Cancel. Keep modal dismissible to background. Complete: **Show in Media**, destination, sidecars/subtitle count. Unsupported site, network interruption, disk full and format unavailable are distinct messages; retry reuses URL/destination but can re-fetch formats. A daily yt-dlp update check and a manual update action are visible under Tools; checksum mismatch blocks use and points to repair, never “Run anyway”.

Settings → Tools follows [settings-connections.md](settings-connections.md): automatic checksum-verified downloads, source and verification columns, live phase/byte progress, cancel/retry, and yt-dlp update actions. Whisper models report actual installed state, size, progress and default selection; do not assume base/small are installed. whisper-cli's local build prerequisite is separate from model downloads. Model stays loaded is informational, not an endless running-job badge. The existing Remotion licence section is unchanged by the accounts/tools repair.

## 10. Transcript, captions, editable elements and audio

### Transcript dock

Switch left editor dock Media → Transcript. Source selector, Local Whisper model selector, Generate/Regenerate. If no transcript: “Transcribe this clip to edit captions and find a moment.” Transcribing state shows source name, model, phase/progress, Cancel; footage remains editable. Cloud Scribe clearly labels external processing and credentials needed.

Word-timed transcript paragraphs have timestamp gutter48 px and 13 px/1.6 prose. Current word underline, selected word blue background. Click word seeks; double-click enters spelling edit only in Captions edit mode, not generic source transcript (source transcript edits don't silently change all caption items). Search highlights matches and jumps through them. **Generate captions** requires selected clip, maps only its trimmed portion and speed into timeline. One history entry.

### Caption Inspector

Word rows: word text, start/end fields, ±1 frame controls available on selected word. Keep word timings monotonic and within block. Invalid timing stays in field with reason; no silent reordering of words. Style presets Clean/Bold pop/Karaoke/Boxed, sample on current preview. Highlight Current word / None / Pinned word. Split at selected word; Merge with next only when compatible and valid. Multi-caption style change is one operation. Confidence warnings say “Check this word”, not a claim that transcription is wrong.

### Text and composition Inspector

- Text: content textarea, font family, size, weight, case, spacing, line-height, alignment.
- Style: colour/gradient, stroke, shadow/glow, background, radius, opacity, blend mode if supported.
- Layout: x/y/width/height with units, rotation/anchor, centre buttons. Units consistent with contract; map normalised coordinates to output pixels visibly, never store pixel guesses as normalised values.
- Timing: start/end, animation in/out presets, duration and easing (no keyframe editor).
- Layer: within-track order; **Behind subject** toggle. Disabled if no underlying subject clip; explanation “Place this over a video clip first.”

Font menu: project fonts first, system fonts second; optional Google Fonts is a separately consented download, not a background dependency or automatic network request. Once downloaded, use local cached font. Missing font substitutes visibly and offers Replace/Locate; export warns if unresolved. Remotion first-use licence dialog quotes the current bundled terms, including company licence requirement for for-profit companies with more than 3 people, and links official terms. Acknowledgement is not represented as purchasing a licence.

Behind subject toggle instantly records intended setting, then shows “Preparing subject mask…” and progress. Until ready show previous compositing with a clear “Mask preparing” badge; don't falsely preview the completed effect. Failure offers Retry or Turn off; it doesn't silently toggle the user's property. Changing the toggle again cancels unneeded work if possible. Track subject reframe offered only for supported aspect/capability; progress and fallback to manual are explicit.

### Audio panel

Right dock tab Audio. Secondary sections Voiceover / Effects / Music / Clean up / Dub, not five simultaneously expanded forms. Voiceover script supports one line per clip, voice picker (My voices / Library), model, speed and advanced stability/similarity/style. Credit estimate immediately above Generate. Existing line selection offers Regenerate this line, preserving other lines. Generated provenance and settings visible in Inspector, read-only until explicit regeneration.

Clone flow: Add samples (drop/record/extract selected range) → Review samples → Consent → Create voice. Required radio choice “This is my voice” / “I have the speaker's permission”, no preselection. Explain data sent to ElevenLabs; keep sample remove controls. Professional cloning only if account supports it. Consent record accompanies voice details.

Effects/music duration and mood explicit; insertion playhead/track previewed. Isolator/voice changer retain originals and create generated audio. Dubbing language list creates new version filenames; never overwrites source cut. Large credit confirmation gives estimate, current balance and explicit **Generate using approximately N credits**; no exact promise for an estimate.

ElevenLabs Accounts uses an API key stored in macOS Keychain, a last-four-only saved preview, Verify/Disconnect and the plan/usage detail actually returned by its API. The built-in ElevenLabs MCP server and Audio dock use this same connection. An optional, separate hosted MCP connection is experimental; it never inherits API-key status and offers no invented OAuth flow when the runtime lacks an approved handoff. Connection alone does not enable unbuilt audio-generation features. No credits display when unknown: “Balance unavailable”, not 0. See [settings-connections.md](settings-connections.md) and [round5.md](round5.md).

## 11. Ask, agent chat and approval

⌘K or Ask opens a 480 px max popover anchored to selected element when enough space, otherwise centred over preview. Existing selection not required: without it, context is current project/time and explicitly says “Whole edit”. Chips identify element names, item count, range or frame area. Summary has a **View context** disclosure with source names, props and timestamp; no secret media URL. Message field 3 lines minimum, paperclip, mic, **Pin feedback**, **Send**. ⌘Enter sends. Selection is frozen at opening, with Update selection option if it changes underneath. Do not silently re-target a drafted request.

Ask is an editing session; separate **Ask a question** control opens read-only session and labels “Read-only · won't change files”. Active run chats offer delivery modes **Now** (between tools), **Stop and redirect**, **Next turn**. Send button shows current mode; description clarifies interruption and that it cannot undo an already completed tool. A pending question from an agent is pinned above composer with a named answer field; only that member is paused unless engine says whole run paused.

### Agent changes are live, reviewable edits

The architecture applies operations through TimelineService; therefore changes appear in the live edit as they happen, **not as a pretend isolated branch**. At completion show “Review 3 changes” and per-item/prop before → after. Amber dashed outline/badge indicates changed items; blue solid selection can coexist outside it. Use same amber for all pending agent changes; show member name/icon rather than rely on a rainbow of agent colours. Keep/Revert grouped by coherent request, with affected items count; item-level actions supported.

- **Keep** acknowledges current changes and removes pending highlight; it does not apply the edit again.
- **Revert** submits targeted inverse operations for this request's affected item/property paths, not a global history jump. Keep unrelated user and agent edits.
- If user edited an affected path since the agent change, show “You changed this after the agent” and compare Original / Agent / Current. Offer Keep current, or explicitly Restore original. Never overwrite current work through an automatic revert.
- During agent work, user's directly edited props are protected. Show lock-shaped “Edited by you” metadata and a clear request to allow changes when agent needs to touch them. Not a permanent item-wide lock.
- Keep all / Revert all operates only on the visible request's pending changes and confirms conflicts. Revert is itself undoable, with actor You and explanatory label.
- A/B is Before this request / Current, timestamp synced, not arbitrary newest exports. If no before-frame is available, show property diff, not a fabricated screenshot.

Right dock Assistant: header member/workflow state, compact phase line, messages, collapsible tool activity, change review block, sticky composer. Tool paths secondary and collapsed by default. No terminal output taking the visual lead. Running status derived from engine events. “Checking the result” means a real review step, not agent prose about self-confidence. Gate failed banner includes finding links and current fix round. Max loops reached says **Needs your input** with remaining blockers, not endless spinner.

## 12. Run screen and Studio

Runs project tab lists status, goal (2-line max), start, member count, API-equivalent estimate. Opening a run uses header goal/attachments/status plus Stop, New goal on this result, Send feedback, Undo run. Cost is always labelled **API-equivalent estimate**, including tooltips on compact summaries. Unknown spend is —, not $0.00. Paused, Waiting for answer, Needs your input, Finished, Stopped and Failed are distinct statuses.

Tabs: **Studio, Plan, Board, Chat, Activity, Changes**. Default Studio. Preserve timeline/time context when jumping from findings into Editor; Back to run link returns to source finding.

- Studio: original pixel-art edit suite, muted room palette, desks32 px grid scaled by integer factors; no fake web-app screens in monitors. Every desk also has semantic button/label and state text. Idle = asleep, working = typing, question = raised hand + question badge, paused = hands away, finished = relaxed. No visual typing while engine says paused. Reduced motion static poses. Layout wraps desks without making room infinitely wide. Clicking opens member details/chat drawer with model, scope, current step and estimate. Small activity bubble max two lines. State text is authoritative; sprite is an illustration.
- Plan: ordered steps, member assignments, latest validated report; report invalidity visible. Reviewer findings timestamp links seek/select item.
- Board: fixed step columns min220 px, horizontal scroll, card per member/fix round. Gate shows expression and Pass/Fail/Not evaluated, plus actual report value. Loop arrows labelled “Fix round 1 of 2”; do not infer outcome from model text.
- Chat: member list left, selected thread right; unanswered questions pinned, same delivery modes as Assistant.
- Activity: append-only event list, filters and pinned problems; expansion shows redacted technical payload. Engine event timestamps, not generated chronological summaries.
- Changes: grouped file status (Added/Changed/Removed), member, readable timeline operations, text differences only for actual text files, A/B render comparison with synced playheads and wipe. Do not title this “Code review”.

Undo run dialog summarises snapshot, files affected, preserved renders moved aside, and user-modified files since run. Conflicting files require explicit per-file choice; default preserve user's work. Show disk-space/copy warning on non-APFS. Success lists what restored and what preserved. Never claim raw was restored if it wasn't touched.

## 13. Home, wizard, backlog and notes

**Current implementation:** [round5.md](round5.md) supersedes the team/run wizard below with a single New project dialog, persistent recents, create-in-place for footage folders and Home Start into the Assistant. Teams/Runs/Backlog/Notes remain unavailable in this round; do not implement mock workflow states from this longer-term specification.

Home gives the next action first: 24 px “What do you want to make?” above goal field, attachment/mic, project selector, Start. No marketing hero. Below: live/recent runs, today's/week's API-equivalent estimate and tokens, plan5-hour/weekly usage/reset countdown if available, ElevenLabs balance, run outcome/gate pass rate and spend/member. Small usage table instead of many identical cards. Sidebar shows a compact usage meter only when data exists. ⌘N opens/focuses global goal composer; starting requires project/team choice if none selected.

### New project wizard

Dialog width760, breadcrumb steps with real sequence: 1 Footage / 2 Team / 3 Goal. Back retains all data. Cancel confirms only if a run/project would otherwise be created or unsent user content lost.

1. **Where is the footage?** Choose folder / Start empty. Project destination separate from source folder. Create standard layout checkbox. **Copy into project (recommended)** uses APFS clones when possible; **Move files** is secondary, destructive-to-source, with count/path confirmation. Do not call copy “Link” unless true linked-file support exists. Advanced remapping table previews actual folders. Warn on collision, existing projects open instead of overwrite.
2. **Who works on it?** Template list (Teaser/social cut, Talking head/captions, Motion/explainer, Social formats, Podcast clips, Voiceover, Dubbing), role summary and workflow preview. **Design a team by chatting** opens architect without discarding wizard.
3. **What should they do first?** Goal, attachments, format segmented ratio, resolution and fps, engine default HyperFrames (Remotion advanced/licence-gated). Start makes project then run; show exact failure boundary if creation succeeds but run fails. Offer **Open project** and Retry run, never create duplicate folders on retry.

Backlog: ordered goals, state badge, add/remove/reorder; Start queue. Each goal runs on previous result; question-only check can pause queue. Show item question with answer action, no hidden background continuation.

Notes: list, editor, note history, Proposals with Accept/Reject. Members propose, never silently overwrite accepted knowledge. Proposal comparison previews exact addition/change. Curator authority is visible. Unsaved human draft preserved across tabs.

## 14. Teams, Settings, feedback and notifications

### Teams

Template picker → team with Members / Workflow / Settings / YAML / Files / Chat. Members forms: role prompt, model, effort, tools, write scopes, allowed messaging/request-work, report schema, limits, skills/plugins and network domains. Plain-language scope preview (“Can write compositions/ and timeline; can't change footage”). Advanced glob text available. Dangerous scope/network broadening shows explicit confirmation; never imply all members share one unrestricted shell.

Workflow graph: nodes min200×96, left-to-right main steps, visibly bounded parallel group, gate decision badge and loop handle. Drag ↺ handle to named prior step, then max-loops field; keyboard alternative **Set fix destination** dropdown and max-loops input. Selected edge has label and delete action. Graph is editing a deterministic configuration, not model-generated control flow. Invalid cycles/unknown targets block save with real validator errors. Raw YAML validation inline by line after200 ms; form changes preserve comments/formatting. Save disabled while invalid; error summary links fields/lines. Files advanced editor scoped to team prompts/schemas. Chat is the architect, save only after validation succeeds.

### Settings

See [round5.md](round5.md) for the implementable Sandbox, Voice input, Render presets, Storage / snapshots and Extensions sections, including Codex CLI sign-in and optional experimental hosted MCP. It also defines the record-then-transcribe voice flow for this round rather than continuous automatic chunks.

Left section list: Accounts (Claude, OpenAI, ElevenLabs), Tools, Sandbox, Voice input, Render presets, Storage/snapshots, Extensions. Narrow version one settings column and section selector. Accounts and tool setup follow [settings-connections.md](settings-connections.md): Claude Console API key is recommended, or the user's own Claude Code sign-in completed in Terminal. Cutroom does not offer embedded claude.ai login or handle its tokens. API keys are validated in main before Keychain storage, cleared immediately from renderer inputs on submission (including failures), and never shown later except the main-provided last-four preview. Connection test names active mode, no credentials. Snapshot cleanup previews size and affected recovery points, requires confirmation. Extensions install shows command, destination domains, scopes and sandbox before **Install**. No blind execution from pasted JSON.

### Feedback

Comment control offers Moment / Range / Area / Selected element. At current time label **Comment at 0:12**. Paused frame area tools clearly distinguish comment marquee from crop. Drawer rows show context thumbnail, timestamp/range, text, edit/delete; Unsent/Sent grouping. Markers synced to feedback, no duplication when reloading. Send feedback previews exact numbered goal and count; uses same team on current result. Deleting a comment asks only if substantial text is lost; Undo toast for deletion. Reviewing render pins retain that file version even when new versions appear.

### Notifications, voice and quit

Bell popover width360, named status icon, text and timestamp. Question → member Chat, escalation → Board, render → Media. Unread counts clear only on view/mark read. Native notifications when unfocused respect OS settings; secrets/voice sample text never in notifications.

Mic beside all message/goal/Ask/feedback inputs: Idle → Listening → Transcribing → Idle/error. Listening uses microphone+text and elapsed time, not only red dot. Pause about1 s commits a chunk; pending transcript greyed and labelled pending, confirmed transcript normal. Escape discards only uncommitted chunk, not text already appended. Stop button ends listening without sending message. OS denial says how to enable access and offers typing. Cloud engine named before capture. Disabling mic stops stream tracks.

Quit guard for active runs/renders: **Keep working** default, **Stop and quit** destructive; list active work and what will be cancelled. No ambiguous “Quit anyway” that hides consequence. Stop progress before exit, preserve clean versions and run recovery state; failed stop explained rather than immediate disappearance.

## 15. Keyboard map

All shortcuts use macOS symbols; actual bindings use physical keys with platform command modifier. Suppress editor/timeline bindings in text fields/contenteditable, menus, modal dialogs and composition text editing. Native text editing shortcuts remain native. Global shortcuts must not throw away unsent content. Menu items expose equivalent commands and current disabled reasons. No shortcut starts paid generation without confirmation.

| Scope | Shortcut | Action |
|---|---|---|
| Global | ⌘N | New goal / focus global goal composer |
| Global | ⌘O | Open project folder |
| Global | ⇧⌘N | New project wizard |
| Global | ⌘, | Settings |
| Global | ⌘1 / ⌘2 / ⌘3 / ⌘4 / ⌘5 | Current project's Editor / Runs / Media / Backlog / Notes |
| Global | ⌘B | Collapse/expand global sidebar (outside text inputs) |
| Global | F6 / ⇧F6 | Next / previous workspace region |
| Global | ⌘? | Keyboard shortcuts dialog |
| Global | ⌘Q | Quit through active-work guard |
| Editor | Space | Play / pause |
| Editor | J | Reverse shuttle1×; repeat2×,4× (frame-stepped if reverse decode unsupported) |
| Editor | K | Pause shuttle/playback |
| Editor | L | Forward shuttle1×; repeat2×,4× |
| Editor | ← / → | Previous / next frame, unless preview element-nudge focus mode |
| Editor | ⇧← / ⇧→ | Previous / next10 frames |
| Editor | ↑ / ↓ | Previous / next edit boundary on focused track; all visual tracks if none focused |
| Editor | Home / End; Fn← / Fn→ | Start / end of timeline |
| Editor | I / O | Set range In / Out at playhead |
| Editor | ⌥X | Clear In/Out range |
| Editor | ⌘L | Toggle loop marked range; if none, loop full edit |
| Editor | M | Add marker at playhead; if marker focused, edit label |
| Editor | ⌥M | Comment at playhead / selection |
| Editor | ⌘K | Ask about current selection/project |
| Editor | ⇧⌘E | Open Export dialog |
| Editor | ⌘Z / ⇧⌘Z | Undo / redo timeline or props edit |
| Editor | ⇧H | Open edit history drawer |
| Timeline | V | Selection tool |
| Timeline | C | Cut tool (click item to split); V returns |
| Timeline | S | Split selection at playhead; focused-track item fallback |
| Timeline | Delete / Backspace | Delete selected items, leave gaps |
| Timeline | ⇧Delete / ⇧Backspace | Ripple delete selection on its own track(s) |
| Timeline | N | Toggle snapping |
| Timeline gesture | Hold ⌘ | Temporarily bypass snapping |
| Timeline | ⌘= / ⌘− | Zoom ×2 / ÷2, anchored at playhead if visible |
| Timeline | ⇧Z | Fit full timeline to width |
| Timeline | ⇧F | Fit selection/range to width (full edit fallback) |
| Timeline | Tab / ⇧Tab | Next / previous item in focused track |
| Timeline | ⌥↑ / ⌥↓ | Focus previous / next track (does not move media) |
| Timeline | ⌥← / ⌥→ | Move selected item1 frame, Shift adds10; rejects overlaps |
| Timeline | ⌘A | Select all items in timeline; not global file selection |
| Timeline | ⌥[ / ⌥] | Trim selected item's start/end to playhead if valid |
| Timeline | ⇧M / ⌥⇧M | Toggle focused track mute / solo |
| Preview element mode | ← / → / ↑ / ↓ | Nudge selected editable element1 output px; Shift10 |
| Preview | Escape | Leave element-nudge/text/area mode first, then clear selection |
| Selection | Shift-click | Add/remove from selection |
| Selection | Escape | Cancel gesture, dismiss popover, then clear selection (one level each press) |
| Ask/chat/goal | ⌘Enter | Send (when enabled) |
| Ask/chat/goal | Escape | Stop/discard pending voice chunk first; otherwise close transient composer |
| Text in preview | Enter / ⇧Enter | Commit single-line / newline where allowed |
| Text in preview | ⌘Enter | Commit multiline text |
| Modal/menu | Escape | Dismiss unless destructive work requires explicit choice |
| Menu/list | ↑/↓, Home/End, Enter | Navigate and choose |
| Splitter | Arrows / Shift+arrows | Resize8 /32 px; double-click resets |

Do not implement FCP/Premiere's destructive I/O-to-trim semantics for this simple editor. Range commands are safe selection only. No keyframe, multicam, nested-sequence or track reorder shortcuts. Clipboard clip copy/paste is omitted until stable item/source duplication exists; don't advertise a dead binding.

## 16. Renderer acceptance checklist

- Editor renders empty, populated, small-window and missing-source states in both appearances.
- Eight tracks in exact order, B-roll visibly above Video in canvas stacking.
- Main view and full Media tab show read-only-for-agents guarantee correctly.
- Move/trim each produces one history entry and cancel produces none.
- Timeline and Inspector selection agree by id; direct text/colour changes are instant and never launch agent.
- Preview has keyboard-accessible seek, timeline has non-canvas item actions, splitters and handles have alternatives.
- Agent pending change state distinguishable from selection, with targeted conflict-aware Revert; no global jump masquerading as item revert.
- Export warns about unsupported layers before start, measured progress and real version after completion; dismissing modal backgrounds job.
- Errors preserve drafts/context; unknown spend/usage/ETA never fabricated.
- Mockups are visual references only. Real status, tool availability and data come from typed IPC/event log.
