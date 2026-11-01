# Component catalogue

Use with `spec.md` and `tokens.css`. Dimensions are CSS px at 100% scale. Neutral default text uses primary; secondary is metadata, muted is supporting copy. Essential information never uses disabled colour. User selection = solid blue, pending agent edit = dashed amber, focus = offset blue ring. They may coexist.

## Shared state rules

| State | Treatment |
|---|---|
| Default | panel/input surface; necessary control boundary strong; no shadow except overlays |
| Hover | bg-hover; don't move or scale; tooltip after400 ms for icon-only controls |
| Focus-visible | 2 px focus-ring, 2 px offset, not clipped; retained while active |
| Pressed | bg-active or accent-pressed; `aria-pressed` for toggles |
| Selected | bg-selected + selection outline/check/active underline; selection is not keyboard focus |
| Disabled | native disabled / aria-disabled, disabled text and no hover; nearby reason for unavailable key action |
| Error | danger boundary and icon, inline explanation; preserve entered value; aria-invalid/describedby |
| Busy | original label becomes phase/action label with spinner; preserve width and prevent duplicate submit |

Pointer targets 28×28 minimum for dense desktop controls; 24×24 permitted for secondary toolbar controls with ≥4 px separation. Timeline trim handles have8 px hit width and equivalent keyboard field actions. Do not style a 12 px glyph as a 12 px target.

## Timeline components

### Clip

Lane inset4 px top/bottom, radius4 px, tinted1 px border, minimum visible width1 px (true duration); hit geometry may extend to8 px. Label12 px/16, horizontal inset6 px. Filmstrip uses bottom remaining height; waveform fits height minus16 label. Background/text/border from type-specific tokens.

- Hover: lighten border, reveal trim grips and overflow button if width permits.
- Selected: 2 px solid blue inset outline; blue label backing optional, not a full colour replacement.
- Focus: offset ring outside clip so selected remains distinct.
- Dragging: original dashed footprint at40% visual opacity, moving ghost at85%, floating time/delta at pointer offset16.
- Trimming: active edge2 px accent, tooltip, source-bound clamp; both bounds in accessible Inspector.
- Muted: waveform/thumbnail35% opacity, text remains secondary; mute icon. Clip gain zero isn't visually equivalent to track muted.
- Agent changed: dashed amber outer outline plus “Changed” badge/member tooltip. Selected outline remains inner blue.
- Missing/error: hatched media region + broken-source icon; readable filename and Locate action.
- Invalid drop: danger outline/hatch and explanation, never just red.

### Track header

Width148 default; match exact lane height. Horizontal padding8, icon12, gap6, label flexible, M/S22×24 each. Truncate long label visually with full accessible name. M/S outlined in active state, with `aria-pressed`; tooltips include track. Selected/focused track gets inset2 px left accent and bg-selected, independent of selected items. Muted header says “Muted”; solo says “Solo” in accessible description. No reorder grip. Header is sticky horizontally, and scrolling stays shared with lanes.

### Ruler / range / markers

Height28, tabular12 px labels, ticks4/8 px. Labels≥64 px apart. Range handles6 px with16 px hit geometry; selected band15% equivalent token colour, caption “In / Out”. Marker glyph10×10 with20 px target. Hover shows time+label; focused marker has ring. Warning triangle for findings, bubble for feedback, diamond for plain markers. Range spans exact duration. Track/ruler grid subtle and noninteractive.

### Playhead

Line1 px coral, head9×8, pointer target12 px on ruler only. Focus head gets blue ring, not recolouring entire line. During drag display time bubble. Keyboard seek input available from transport; current time ARIA value updated on keyboard seek/release, not every frame. Snap guide is dashed neutral/blue with target label so it cannot be mistaken for playhead.

## Controls

| Component | Size / geometry | Specific states and behaviour |
|---|---|---|
| Primary button | height28 (dialog36), padding0 12, radius5, 12 px semibold, icon16/gap6 | accent bg/text-on-accent; hover accent-hover; pressed accent-pressed; disabled neutral bg; only one main primary per dialog |
| Secondary button | same | input/panel bg, strong border; hover bg-hover; pressed bg-active |
| Quiet/icon button |28×28, toolbar24×24 | transparent; hover bg-hover; active bg-selected; always named |
| Destructive button | height28/36 | danger-bg + danger text + strong danger boundary; irreversible action explicit verb |
| Segmented control | total28 high, item min48, inset2, radius5 | checked bg-active; shared1 px strong border; radio semantics, left/right keys |
| Text input/select |28 high, inset8, radius5, border1 strong,12/13 px | bg-input, focus ring; error message directly below; units right-aligned inside separate suffix, not placeholder |
| Textarea | min72 high, padding8,13 px/1.6 | resize vertically only if layout permits; persistent label; draft preserved on failed submit |
| Number/time field |28 high, min64 wide, tabular numerals | right align numbers, stepper appears on focus/hover; Enter commit/Escape restore; unit labelled |
| Slider | rail3, thumb12 circle, target28 high, min96 wide | filled accent; thumb border contrasts rail; focus thumb ring; numeric field alongside; one release commit |
| Checkbox |16 square in28 target, radius3 | check icon, mixed dash; error label; native keyboard Space; consent always unchecked initially |
| Toggle |28×16 in32×28 target | thumb12, visual checked fill; adjacent label; not a replacement for required legal checkbox |
| Colour field |28 high, swatch18×18 + hex | transparent swatch checkerboard; typed hex validation; colour picker has focus trap only if modal |
| Tabs | project40 high; panel36 high | active text primary +2 px accent underline, hover bg-hover; roving arrows, Home/End; aria-selected |
| Disclosure |32 high, full width | chevron12 rotates only on explicit action; heading not all caps; open state aria-expanded |
| Search |28 high, icon14, clear24 | field accessible label independent of placeholder; Escape clears query before closing parent |

## Lists, menus and messaging

### Media card / row

Full grid min196 wide, thumbnail16:9, body12 inset; filename13 semibold, metadata12; border1 subtle, radius5. Hover strong border; selected blue outline; focus offset ring. Compact bin card uses inset12 and170×82-ish crop determined by available width, filename12 and duration11. Footer read-only guarantee is text+lock, not icon-only. Loading shimmer is unnecessary: neutral static thumbnail skeleton; errors show type fallback and retry.

### Menu

Min180/max320 wide, padding4, item28 high, inset8, radius8, bg-panel-raised, menu shadow. Icon16, shortcut right-aligned11 px secondary. Dividers1 px with4 px vertical margin. Hover/focus share bg-selected, active checked icon. Disabled items keep reason in tooltip/adjacent description; submenus on arrow/Enter as well as pointer. Escape closes and restores invoker. Selected radio item shows checkmark. Context menu never changes selection silently; right-click selects target only if not already in multi-selection and opens matching actions.

### Dialog / sheet

Small confirmation440 wide, default560, URL640, export720, wizard760, max calc(100vw -48px), max-height calc(100vh -48px). Header20 inset, title18/600, close28. Body20 inset, footer16/20 with1 px top divider. Radius12, dialog shadow, backdrop token. Footer sticky inside modal while content scrolls. Semantic role dialog/alertdialog, labelled title and relevant description; initial focus first field for forms, safe/cancel action for destructive confirmations. Focus stays trapped; background inert. Small-window sheets cover upper workspace only when designed as nonmodal Inspector, not an inaccessible half-modal hybrid.

### Toast / banner

Toast320–420 wide at bottom right24 inset (above timeline transport only if it doesn't obscure active gesture), padding12, radius8, menu shadow. Icon16, message13, optional action28. Success/info expire after6 s, pause on hover/focus; error persists. Never toast-only for lost persistence. Close28. `role=status` polite for completion; alert only blocking failure. Stack max3, additional entries in jobs/notifications. Banner full region width, padding12, status-bg, border-left3 status, explicit text+actions; no colour-only severity.

### Progress

Bar4 high (inline2), radius-pill, track bg-hover, fill accent. Percent label12 tabular, phase label13, ETA12 secondary. Determinate `aria-valuenow/min/max`; indeterminate omits now and states phase. Cancel remains outside changing progress region so it doesn't move. Completed check icon and text; no perpetually spinning “100%”. Announce phases/coarse milestones not10 updates/s. Studio motion is separate, never the sole progress representation.

### Assistant message / change review

No bubble around every message: role/name12 semibold above prose13/1.6, max line length70 characters. User messages have a modest bg-input inset; tool activity12 secondary collapsed with disclosure. Avatar20 square with letter/role icon, not photoreal person. Message gap20, tool gap6. Composer min88 high, border strong, radius8, sticky bottom12. Attachment chips24 high, icon14, filename truncated and remove24.

Change group border1 amber, bg agent-change-bg, radius8, header32, readable before/after rows min32. Removed value strikethrough + “Before”; new value + “After”; current user conflict a separate labelled row. Keep primary-neutral, Revert secondary; no green/red buttons implying moral correctness. Pending/kept/reverted status words persist in history. Review actions min28 high. Selection context chip24 high with element/range icon. Enter does not send multiline composer; ⌘Enter does.

### Selection handles / tooltip

Outline1 blue, corner handles6 with≥16 targets, white/dark backing for video contrast; rotation handle6 at18 offset. Focused handle ring2, hover fills accent, inactive prop has no visible handle. Tooltip12 px, padding6 8, radius5, raised surface/strong border/shadow, max280 wide, max70-char lines; delay400 ms. Essential error/action explanations never tooltip-only. In canvas use fixed readable dark tooltip with text-primary even in light mode if necessary; do not inherit mismatched theme text.

## Status vocabulary

- Job: Queued / Preparing / Running phase / Finishing / Done / Cancelled / Failed.
- Run: Running / Waiting for answer / Paused / Needs your input / Finished / Stopped / Failed.
- Change review: Changed / Kept / Reverted / Conflict.
- Persistence: Saving… / Saved / Couldn't save.
- Account: Connected / Not connected / Connection expired / Balance unavailable.

Every status has text and icon, not dot colour alone. Use ellipsis only for incomplete activity or actions that open a required input dialog, not decoration.
