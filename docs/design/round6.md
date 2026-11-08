# Chat-first editing desk

Design handoff · 2026-11-08 · F1–F7. This supersedes spec.md §2, §3's separate Media page, §5's toolbar/gestures/range shortcuts, §11's assistant placement and review presentation, and conflicting bindings in §15. It also supersedes round5.md's Sources / Editor tools disclosures, Folder media link, unavailable navigation stubs, Ask dialog and manual Whisper-build guidance. Unchanged export, protected-source, history, conflict and account-security contracts still apply. Mockup contents are fictional, not implemented feature claims.

## 1. Visual plan and critique

Retain graphite `#191c20`, slate `#23272d`, chalk `#e8edf2`, steel blue `#9cc8ef`, edit amber `#e3bf7a`, and coral playhead `#f0b1a8`. System sans, 13px working UI; chat prose 13px/1.6; headings 15/18px; metadata 12px. Tabular numerals for time, monospace only for literal paths/commands. Offline Lucide icons, 16px/1.75 stroke, no provider-colour decoration.

The distinctive structure is **conversation alongside the cut**: chat has a stable column, preview remains the largest upper surface, and a single media shelf replaces competing navigation. Left-align everything except video and transport. Contiguous panels use dividers, not a dashboard of floating cards. Bordered cards in chat mean a decision or a reversible change, not every message. The existing coral cut line and blue-selected / amber-dashed-changed semantics remain.

Critique: making chat merely another Inspector tab would not answer the brief. It is now permanent by default. A new page of media cards would preserve the confusion; remove that page and use one grouped list. Do not compensate for fewer navigation items with a new activity dashboard or a giant tool palette.

```text
44px  native titlebar / project name / saved                 Undo Redo Export
      ┌──────┬────────────────────┬────────────────────────┬───────────────┐
      │ 56px │ Chat               │ Preview                │ Media         │
      │ rail │ messages           │                        │ Inspector     │
      │      │ questions / review │ fitted output          │ Audio         │
      │ Home │                    │                        │ Transcript    │
      │ Proj │ composer           │ transport              │ grouped list  │
      │ Skill├────────────────────┴────────────────────────┴───────────────┤
      │      │ tools / ripple / snap          range / marker / zoom / Fit │
      │      │ track headers │ ruler / range / markers                    │
      │      │               │ 8 scrollable timeline lanes                │
      │ Set  ├───────────────┴────────────────────────────────────────────┤
      │status│ operation hint                                  duration  │
      └──────┴───────────────────────────────────────────────────────────┘
```

## 2. Shell, dimensions and compact rules

- Default review viewport **1440×900**. Supported desktop minimum remains **1024×680**. Rail is always **56px**, with Home, Projects, Skills and Settings; 36px targets, tooltips and accessible names. Setup progress and connection status sit at the bottom; clicking opens Tools / Accounts. Status needs icon plus accessible text, not colour alone. No recents, folder link, Teams, notification bell, plan quota, project-tab bar or separate Ask control. Recents live only on Home and Projects.
- Titlebar **44px**: native window inset, project name, confirmed save status, Undo / Redo / Export. Long name truncates with full-name tooltip; do not truncate an error. All actions no-drag. ⌘K focuses chat directly, including from text inputs; there is no Ask dialog.
- Upper workspace: **380px Chat | minmax(0,1fr) Preview | 300px right panel**. Chat resizes **320–520px**; right panel **272–360px**, subject to keeping preview ≥360px. Priority when space shrinks: clamp chat, clamp right panel, then use compact rules. No application-level horizontal scrollbar.
- Chat header **36px**, title “Chat”, status text, collapse button. Collapse to a **40px** strip with labelled/accessible “Open chat” button and an attention dot plus pending-answer count when applicable. Collapse is explicit, never caused by selection or an agent event. ⌘K and Home Start reopen chat. Preserve draft, messages, model, selected skill and scroll. A new question does not steal focus or auto-expand a manually collapsed chat.
- Chat splitter: 1px visible line / 8px hit area, role separator, vertical, min/current/max. Left/Right changes 8px, Shift changes 32px, Home/End min/max, double-click resets380. Clamp without changing playback. Horizontal timeline divider follows the same contract with Up/Down, default396px, min240px, max65% of window height while retaining upper region ≥230px.
- Right panel tab order **Media | Inspector | Audio | Transcript**, header **36px**, controls24–28px. Default Media. Selection never switches the active tab or hides chat. An explicit “Inspect” command may open Inspector. Tabs use roving focus, Left/Right/Home/End; Tab enters body. Header pinned; body independently scrolls.
- **1280px and above:** all three upper columns open initially. Use stored sizes only within the available bounds. Timeline396px by default.
- **1120–1279px:** chat320px, right272px, fluid preview (472px at1120). All remain open. Remove secondary preview metadata before removing transport actions. Timeline toolbar may use two rows. No old Sources / Editor tools disclosures.
- **1024–1119px:** chat320px remains open. Right panel starts closed on first entry; preview-header **Media** button opens the remembered tab in a **280px** nonmodal dock beside preview (368px preview at1024). Dock Close returns focus to the opener; moving across the breakpoint restores focus there before hiding focused contents. User-open state is preserved within this compact interval. Closing does not discard form edits. Do not overlay video, timeline or composer. When closed, the Media button is the only panel entry point, not a second folder list.
- Below supported desktop size, **976–1023px** follows the same constrained layout. **≤975px** is an accessibility reading fallback: upper contents flow Preview/transport → Chat → optional right panel, followed by timeline. Page scrolls vertically, each reading panel max60dvh; preview fits width. Rail remains56px. At≤700px use36px controls and stack composer/settings rows. Timeline alone scrolls horizontally; track headers stay pinned. Do not claim a full mobile editing workspace.
- At1024×680 use timeline280px and upper≥230px; chat stream scrolls but composer stays accessible. Native dropdowns, menus and question answers scroll inside their region. No minimum-width descendants may force the document wider.

## 3. One Media panel

Header has search and **+ Add** menu: **Import files**, **Import from URL**, **Add composition**. No duplicate import toolbar elsewhere. Menu supports arrows, Home/End, Enter and Escape, restoring trigger focus. Existing file/URL/composition dialogs remain the real flows. Dropping files into preview or Media opens the same import flow; import copies, never moves originals.

Group order: **Footage** (`raw/`), **References**, **Assets**, **Audio**, **Compositions**, **Exports** (`final/`), **Folder root** only when loose media exists. Use friendly names as primary labels, real relative path in tooltip/detail. Group disclosure32px with count; retain collapse state. Empty group has a quiet single-line status, not another large CTA. Folder root helper: “Files stay here. Agents can't change them.” Action **Copy into Footage** retains originals; success “Copied to Footage. Original kept.” No second project/folder explorer.

Media row **56px**, 12px horizontal inset, **48×32px** thumbnail, 8px gap; name13 with ellipsis/full tooltip, kind/duration12 secondary. Selected uses selected background plus blue edge; focus is independent. Hover exposes a28px overflow button; keyboard exposes identical actions. Single click selects, double-click plays source in the inline player with **Source** / **Back to timeline** labels. **Add to timeline**, **Inspect**, **Copy into Footage** where applicable. Drag uses existing media payload and a labelled timeline ghost. Unsupported / still-probing sources show a reason, not guessed duration. Source thumbnail failure never hides a filename or blocks editing.

Importing: one progress row above the list, measured phase/count, independent Cancel. Partial failure keeps successful rows and lists failed names with Retry. URL import keeps explicit rights confirmation; Auto-approve does not check rights or dismiss it. Empty project preview: “Bring in footage, or describe your video in chat.” **Add media** opens the sole Media panel/menu; **Focus chat** focuses composer. Empty timeline keeps eight lanes, one drop hint.

## 4. Chat, approvals and decisions

### Stream and composer

Header status: Ready, Working, Waiting for your answer, Needs permission, Stopping, Stopped, or Failed. Use actual service state; no timer/percentage invented for model thinking. Messages are primary, no avatar-heavy bubble stack: author13 medium, body13/1.6, 16px gap. User text may use a slightly raised background. Stream scrolls independently; auto-scroll while at bottom, otherwise show **New activity** rather than pulling the reader away. Errors are in-stream Notices with safe details/Retry; failure never clears typed text.

Tool activity collapses to one32px disclosure, e.g. “8 tool actions · Trimming opening clip”. Expand for names, outcomes and safe details. No raw paths/secrets or API-equivalent cost line by default. A running status must remain visible when disclosure is closed.

Composer pinned below stream, 12px inset, input min72/max160px before inner scroll. Label **Message Claude** (may be visually hidden, never placeholder-only); placeholder “Describe an edit, or ask a question…”. Enter sends, Shift+Enter newline; don't send during IME composition. Send disabled for blank or unavailable input with adjacent reason. While running show **Stop**, retaining the next draft; Stop becomes **Stopping…** until confirmed. No send-on-voice-completion.

Two compact wrapping control rows below input:
1. **Model select** (existing configured Claude choices), **Video type** chip/picker, **Voice** icon+accessible label.
2. **Auto-approve** labelled switch (default on), **Read-only** labelled checkbox, **Send / Stop** aligned right.

Auto-approve saves immediately through settings.update, pending/failed status local to the switch. Do not claim changed until saved. Help: **“Approves enabled editing tools automatically. Download rights, overwrites and external extensions may still ask.”** Off: **“Ask before editing tools run.”** It changes approval, not access: disabled sandbox/network capabilities remain disabled. Rights, forced overwrite and saving a skill always keep their explicit confirmations. Session grants do not survive session/project changes. Read-only controls whether Claude can edit, independently of approval. Changing it starts a new session; show “Changing read-only starts a new chat session. Your edit and draft are kept.” Model changes also restart the session; no silent carryover of grants.

### Question card

This is a clarification, not a permission. Neutral panel/strong border, radius8, padding12, 12px gaps; header **“A few details before I start”**, status **Waiting for your answer**. One request may contain1–4 question groups. Render each exact question as a fieldset legend13 medium with optional short header12 secondary. Native radio (single) or checkbox (multi); each option min36px, label13 plus optional description12 on next line. Selected uses blue border/background AND checked indicator. No preselected answers.

Always show **Other** and its text field when selected. In a single-choice group, typed text replaces “Other” as the submitted value. In a multi-choice group, include that text alongside other checked labels; never send the literal “Other” instead of what was typed. Answers are keyed by exact question text. Required groups need a choice or nonblank Other; action **Send answers** disabled with explanation until complete. Long cards scroll with the stream, not a nested tiny answer scroller. Sending → **Sending…**; failure retains all answers and offers Retry; success collapses to a readable answer summary. Do not auto-answer in Auto-approve mode. ⌘K remains available for a new draft, but never substitutes for Send answers. Preserve drafts when the request is interrupted; mark **No longer waiting** and remove submission actions.

For a thin initial brief without references, skill or existing edit, the agent must ask before writing. Example “make a video” → questions on purpose/platform, length, style and source material before any timeline or file mutation. Do not let the UI's empty-state shortcut imply it bypasses this gate.

### Permission and rights cards

Permission card uses a small shield/lock icon, tool/action name, human-readable effect and scope, safe expandable details. **Allow once**, **Allow for this session** only when rememberable, **Deny**. Actions wrap; no horizontal card scroll. Pending disables duplicate response. Deny stays visible and clears the waiting state after service confirms. Session action means this tool only, not every tool. Truncated summaries cannot be approved until the existing safe-review requirement is satisfied.

Rights card remains explicit: source URL/title, destination and rights checkbox unchecked, **Download** / **Cancel**; no session grant. Forced user-edited overwrites and skill-save confirmation likewise have no remember-for-session action. Auto-approve is never labelled “Allow everything”.

### Review

One compact neutral card with a dashed amber left edge: **“N changes”**, **Keep all**, **Revert all**, disclosure **Details**. Min44px,12px inset; don't tint every assistant message amber. Details list item/time/brief before→after and per-item Keep/Revert when supported. Changes already appear live on the timeline with amber dashed outlines. Keep acknowledges; never reapplies. Revert uses targeted inverse edits, not whole-history rollback. If current values conflict, preserve existing Original / Agent / Current dialog, default **Keep current**. A denied/failed operation never appears as an applied change. Whole-run Undo remains a separate explicitly scoped history action.

## 5. Timeline: standard tools, not a palette

Preserve eight fixed tracks and media-kind colours from spec§5. Track header **180px** (compact168), lane heights34/52/42. Label plus **Lock / M / S** are real24px toggle targets, accessible names include track. Ellipsise only the visible name, full tooltip; no track reorder grip. Locked: lock icon, subtle lane hatching, readable clips. Selection/seek/copy allowed; mutations skip locked items with “2 locked clips weren't changed.” Never silently unlock. Undo/redo still restores historical edits.

### Controls and navigation

Timeline toolbar **36px** first row: grouped **Selection(V), Cut(C)**; **Ripple(R), Snap(N)**; **Add text, Marker(M), History**; flexible selection status; **− / zoom slider / + / Fit**. At<1280 move selection status and zoom to a second32px row, max68px total. If space is still constrained put Add text and History in **More**; do not remove active tool/Ripple/Snap indicators. Default Ripple off, Snap on. Buttons28px, persistent toggles expose aria-pressed; tool choice is mutually exclusive. No dedicated Slip/Roll toolbar modes.

Transport, centred under preview, may use two rows: current / total time and **Previous edit, −5s, −1s, Play/Pause, +1s, +5s, Next edit, Loop**. Buttons28px; ± values visible and aria-label includes “seconds”; edit controls have clear tooltip/shortcut. At narrow preview widths, time and Loop sit on row1, navigation row2. Loop active state persists visibly; loop uses a valid In/Out range or full edit. Playback outside a loop starts at loop start; pause is immediate. Never round frame time to fabricated hundredths.

Ruler **28px**; In/Out band uses selected background and accent top edge, bracket handles with12px targets, times in tooltip. I/O set boundaries, X clears; backward range normalises. Shift-drag ruler sets range, ordinary drag scrubs. Range is context for chat/loop/export, never automatic deletion. Marker diamond has12px hit area; double-click/Enter opens label popover with Save/Delete; Escape cancels and restores marker focus. Selected marker Delete removes marker, not clips. Feedback shapes remain distinct. Snap to0, playhead, item edges, markers and In/Out within8 screen px; tie order playhead → item edge → range → marker → zero. Guide1px with target label, not colour alone.

Playhead auto-scroll only when leaving the viewport, moving it back to the leading20% for forward playback (trailing20% for reverse), not continuous recentring. While dragging at32px viewport edge, autoscroll at distance-proportional speed, up to600px/s; keep time readout and ghost stable. Zoom buttons anchor to visible playhead or viewport centre; ⌘wheel / pinch anchor at pointer. Zoom4–512px/s, Fit entire edit +5% trailing room. Respect reduced motion: no animated panning.

### Editing gestures and menus

- Move selected clip(s) after3px threshold. Ghost per item, originals dashed; horizontal change shifts time, vertical change moves to compatible tracks. Preserve selected relative offsets; group commits atomically as one history entry. Video↔B-roll allowed; audio only compatible audio lanes. Invalid ghost hatched/danger outline with “Overlaps Video” / “This track accepts audio”; release leaves originals in place and announces reason. Escape cancels. No implicit overwriting or track creation.
- Empty-lane drag draws1px blue marquee with transparent selected fill; selects intersecting clips. Shift adds. Click empty lane clears selection, does not seek. Ruler/playhead are the seek surfaces. A selects items at/after playhead on selected tracks, all unlocked/locked tracks if none chosen; later edits skip locked clips.
- Trim handles8px hit area; one-frame minimum, source-bound clamp, live delta/source readout. Ripple on uses rippleTrim; **start-edge ripple keeps the item's start position**, changes source in and shifts its tail/later items by duration delta. Ripple off leaves later clips fixed. Source speed conversion follows source seconds. Q/W trim start/end to playhead; Ripple determines whether later clips shift. Out-of-item playhead gives a note, not a destructive guessed trim.
- Delete leaves gaps with Ripple off; with Ripple on or Shift+Backspace, ripple-delete on each affected track only. Process disjoint ranges atomically. Hint “Ripple affects this track only.” No all-track sync promise. Close gap shifts that track's later clips by exact empty gap length. Insert gap opens duration form naming target track/time; one-frame grid, positive duration, Cancel safe default.
- Slip: context-menu **Slip source…** enters a temporary horizontal drag on a media clip, ↔ source cursor/readout; source in/out change equally, timeline bounds fixed, source-clamped. Also show a labelled **Source offset (seconds)** input with Apply/Cancel for keyboard use. Not available for text/caption/composition.
- Roll: context-menu **Roll cut…** on an adjacent pair enters shared cut-handle drag, moving cut and both adjoining edges while pair outer bounds remain fixed; source-clamped. Keyboard form **Cut time** with Apply/Cancel. Disabled with reason if no compatible adjacent pair or either track/item is locked. Enter commits, Escape cancels. Slip/Roll are temporary actions; return to Selection after completion. Do not invent Option+letter shortcuts or ambiguous drag modifiers.
- Clip context menu (right-click / Shift+F10 / Menu key): **Split at playhead**, **Duplicate**, **Copy**, **Cut**, **Delete**, **Ripple delete**, **Slip source…**, **Roll cut…**, **Bring forward / Send backward** on overlap-capable tracks, **Seek to start**, **Inspect**. Gap menu: **Seek here**, **Close gap**, **Insert gap…**. Show unavailable action reasons. Keyboard arrows/Home/End, Enter, Escape; focus returns to clip/gap. Opening a menu does not seek or mutate. Bring forward/back changes within-track stacking, not time or track order.
- Clipboard internal copies retain relative timing/source trims; paste earliest copied start at playhead, same compatible tracks. Duplicate places copied group immediately after its bounding end. Cut removes only successfully copied unlocked items. Group failures are atomic, with reason and no partial hidden paste. New ids/provenance come from command layer. Each command one undo step.
- Filmstrips preserve source aspect (cover crop allowed, never stretch); title uses stable dark backing and light canvas text in both themes. Waveforms align source in/out/speed, canvas limited to visible portion. <24px clips omit artwork; title/tooltip remain usable. Cached source art, request only visible sources; failed art reverts to plain media block without blocking edits. Selected blue outline and agent amber dashed outline can coexist, with focus ring outside.

## 6. Skills / Video types

Rail destination **Skills**. Page title **Skills**, subtitle “Reusable video types for any project.” Header **Save this edit as a skill** only enabled with current project; otherwise helper “Open a project to save its edit.” Responsive grid min260px columns,16px gaps, max1100px, left-aligned. This library may use cards because each represents a reusable object, not a status dashboard.

Card: name15 medium; badge **Built-in** / **Yours**12; description13/1.6; **Use in project**, overflow **Edit**, **Delete** (user only). No fake thumbnails, usage counts or live run badges. Loading, empty-user-library and service-error/Retry distinct; built-ins remain read-only. Use in project targets current project, or opens a recent-project selector with New/Open actions, then selects the type and opens chat. It does not generate immediately.

Composer/Home **Video type** chip opens searchable picker360px max viewport−32, max-height400px, grouped Built-in/Yours. Rows≥52px with name/description, keyboard arrows/Enter/Escape. Initial types: Talking-head short, Product teaser, YouTube explainer, Podcast clip. Choosing sets removable chip and sends skillId with next message. Selecting a skill bypasses the thin-brief gate but does not auto-send. Empty chat may show these four starter buttons, disappearing after the first message. Deselect via named Remove video type; don't clear it when right-panel tab changes.

**Edit skill**640px dialog: Name, Description, Instructions multiline, Cancel / Save changes. Preserves invalid draft; field errors visible. Delete440px confirmation names skill, says “Projects already made with this skill won't change.” Cancel initial focus / Delete skill. Built-ins offer Use only, never editable-looking disabled fields.

**Save this edit as a skill**440px dialog: Name and Description, helper “Claude will extract reusable structure and style, without this project's text or file paths.” Cancel / **Continue in chat**. Continue opens chat and sends a normal request; it does not directly save or mark success. Agent skill_save then shows one explicit preview confirmation of name/description via permission flow, even in Auto-approve. In-flight stream explains “Preparing reusable instructions…”; success only after actual skill creation, with **View skill**. No second renderer trust confirmation on top of the service confirmation.

Home keeps goal composer, Video type, microphone, project selector, Start and recents. Start opens the single project screen with chat visible; no Recent runs block or duplicate Browse media action. Preserve goal through project/account setup.

## 7. Tools and truthful automatic setup

Tool install states: Checking → Downloading → **Building… NN%** (only measured received/total) → Verifying → **OK**. Unknown progress says **Building…** with indeterminate bar. Whisper verification text **Built from pinned source**; don't equate it with a publisher-signed binary. Cancel independently available while downloading/building; after click **Stopping…**, wait for actual cancellation. Request completion/100% bytes alone never means installed. Setup rail indicator counts building as busy.

Missing Apple tools: **“Install Apple's Command Line Tools to enable transcription.”**, **Install developer tools**, helper **“Finish Apple's installer, then choose Retry.”** No OS popup during startup. Only this explicit action launches Apple's installer; do not falsely report prerequisite installed when it merely opened. Whisper failed row keeps **Retry**; no terminal command, “Build required” badge or hidden Install button. Other unavailable/pin/network failures show their actual reason, not this prerequisite action unless service supplies install_clt. Voice unavailable while building: “Local transcription is being set up.” with Open Tools; no silent hosted fallback.

## 8. Keyboard map (round6 authoritative conflicts)

⌘ means Control on non-macOS; ⌥ means Alt. No Option+letter or shifted-punctuation bindings. Suppress editor shortcuts in text/number inputs, textarea, contenteditable, dropdowns and open menus/dialogs; ⌘K is the explicit composer-focus exception. Native text clipboard/select/undo must continue working. Layer Escape: dialog/menu → recording → gesture/temporary tool → compact dock → selection; never discard a saved draft accidentally.

| Scope | Keys | Action |
|---|---|---|
| Global | ⌘O / ⇧⌘N / ⌘N | Open project / New project / Home composer |
| Global | ⌘, / ⌘K | Settings / open and focus project chat (Home composer if no project) |
| Editor | ⌘Z / ⇧⌘Z | Undo / Redo confirmed timeline edits |
| Editor | Space | Play / Pause |
| Editor | J / K / L | Reverse / pause / forward shuttle; repeat J/L increases speed per existing clock |
| Editor | ← / → | Previous / next frame (preview-focused editable element keeps pixel nudge contract) |
| Editor | Home / End | Beginning / end of edit |
| Editor | ↑ / ↓ | Previous / next edit boundary across visible tracks |
| Editor | ⌘← / ⌘→ | Back / forward1 second |
| Editor | ⇧⌘← / ⇧⌘→ | Back / forward5 seconds |
| Editor | ⌥← / ⌥→ | Nudge selected clips1 frame |
| Editor | ⇧⌥← / ⇧⌥→ | Nudge selected clips10 frames |
| Editor | V / C | Selection / Cut tool |
| Editor | S / ⇧S | Split selection or focused item / split all unlocked tracks at playhead |
| Editor | R / N | Ripple toggle / snapping toggle |
| Editor | Q / W | Trim selected start / end to playhead |
| Editor | I / O / X | Set In / set Out / clear range |
| Editor | ⌘L | Toggle loop range, or whole edit if no range |
| Editor | M / ⇧↑ / ⇧↓ | Add marker / previous marker / next marker |
| Editor | A / ⌘A | Select forward from playhead / select all items |
| Editor | ⌘C / ⌘X / ⌘V / ⌘D | Copy / Cut / Paste at playhead / Duplicate after selection |
| Editor | Backspace or Delete / Shift+Backspace | Delete (Ripple toggle respected) / always ripple delete |
| Editor | Held ⌘ during drag | Temporarily bypass snapping |
| Timeline | ⌘wheel / pinch | Pointer-anchored zoom; buttons/slider/Fit for keyboard |
| Clip/gap | Shift+F10 or Menu key | Open context menu |
| Question | Tab / arrows / Space | Standard fieldset navigation / choice / toggle |
| Composer | Enter / Shift+Enter | Send / newline (IME-safe) |
| Separator | arrows / Shift+arrows / Home / End | Resize8px /32px / min / max |
| Dialog | Tab / Shift+Tab / Escape | Trap focus forwards/back / cancel safely |

Preserved nonconflicting base commands: F6/Shift+F6 next/previous region; ⌘Q guarded Quit; Shift+Left/Right10-frame step; Fn+Left/Right start/end on Mac; Shift+⌘E Export; Shift+H History; Shift+Z Fit timeline; Shift+F Fit selection/range; Tab/Shift+Tab next/previous clip when the timeline owns focus; Option+Up/Down focus track (not move media); Shift+M mute focused track. Preview element focus retains arrow pixel-nudge / Shift10px; Enter commits single-line text, Shift+Enter newline where permitted, ⌘Enter commits multiline. Composer may retain ⌘Enter as an additional Send action. Native text-input navigation always wins over clip traversal.

Remove ⌘1–5 project tabs, ⌘B sidebar collapse (rail is fixed), old Option+X, Option+M comment, Option+Shift+M solo, and Option+bracket trim bindings. Q/W replaces bracket trim; solo remains a header action. No shifted-punctuation shortcut for Help: use Help → Keyboard shortcuts. Existing ⌘= / ⌘− zoom may remain only if already supported by the registry; do not add locale-fragile alternatives. Shortcut help must match the implemented command registry, not advertise unavailable gestures.

## 9. Acceptance and references

Static references: [main desk](mockups/round6.html), [question, permission and review states](mockups/round6-chat.html), [timeline gesture and export](mockups/round6-timeline.html). Browser validation recorded in validation.md. These show visual states, not simulated backend operations.

Check1440×900,1280×800,1120×800,1024×680 and narrow reading390×844. One media list; no removed navigation controls; chat visible across selection/panel switches. Test keyboard splitter, collapsed-chat pending question, Other multi-choice, failed settings update, thin-brief stop-before-write, rights exception, targeted review conflict, locked group move, invalid audio-to-video drop, ripple start trim, pointer zoom, partial import and independent build Cancel. Existing export remains spec§7 with only real supported options. Transitions, keyframes, new render-packaging configuration and all-track ripple are out of scope.
