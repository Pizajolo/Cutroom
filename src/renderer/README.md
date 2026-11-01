# Renderer

Cutroom's React renderer starts at `index.html` / `main.tsx` and imports the designer's unchanged system-appearance tokens before `styles/app.css`.

## Implemented foundation

- Home-first app shell; Zustand navigation, project-session/recent-list state, and a goal draft retained across navigation.
- Typed `lib/api.ts`: unwraps `{ok:true,data}` and constructs renderer-local `IpcFailure` objects for failure envelopes. No production browser bridge mock, direct Node access, or arbitrary shell channel.
- Scoped keymap with text-input, contenteditable, dialog, composition and repeat suppression. Command-N opens/focuses Home without discarding its draft. Native dialogs keep their own keys.
- Media folder browsing through the agreed T08 `media.selectProjectFolder` channel. This is explicitly **not** project creation/opening through T07.
- Five media sections, thumbnail sprites, metadata, inline source video/audio, native file imports, confirmed Finder drops, media change subscriptions, step-specific import progress/cancellation, and relative-path drag payloads (`application/x-cutroom-media`, `{rel}`).
- Live tool installation/checksum status, retry/cancel, yt-dlp update checks, Whisper model download/delete/default selection through the S1 bridge. Remotion licence state remains explicitly unimplemented.
- Accounts cards for Claude API keys or an explicit Claude Code Terminal sign-in handoff, OpenAI and ElevenLabs. Connection summaries are shared live with Home, the sidebar and the Audio dock.
- Reusable transport/master-clock, preview selection, timeline culling/snapping helpers, and an eight-track read-only timeline component. These do not create a second persistence authority.

`tests/renderer` contains Testing Library component tests plus clock, geometry, keymap, API and selection-store tests. The merged web Vitest project includes this directory and uses automatic JSX transformation.

## Integration boundaries

The renderer calls only agreed typed IPC. The backend's T05/T08 media/tools schemas and contract are merged; dependency installation is still required to typecheck the renderer. Account and tool/model management use the S1 channels. At this milestone, `project.*`, `timeline.*`, jobs, history, runs, stats, general settings, compositions and voice channels are absent. Corresponding actions are disabled with explanations. A seeded `ProjectSession` can exercise the five-tab editor layout in tests; it must not be mistaken for a project being persisted on disk.

`MasterClock` is dependency-free and testable with an injected scheduler. The Zustand facade is in `editor/preview/store.ts`; transport and playhead subscribe separately. A future media-layer integration must follow that clock and use the visual compositing order (B-roll above Video despite row order). The merged crop schema defines source-normalized coordinates within 0..1, positive dimensions, and containment within the source. Reframe/colour units and export-transform parity still need an agreed implementation; preview/export parity is not claimed.

API keys exist only in the password input's local component state until submission. Submission clears the field immediately, on both success and failure, and sends the key only through `accounts.connectKey`; keys never enter Zustand, localStorage/sessionStorage, logs or UI errors. Only safe IPC error messages and backend-provided last-four previews are displayed. `lib/useAccounts.ts` shares one subscribe-before-fetch connection resource across all consumers; events supersede stale requests. Claude Code sign-in is detected every 3 seconds for at most 2 minutes after an explicit Terminal launch, and only “Use this sign-in” commits the method. Polling is cleaned up on method change/unmount. Goal drafts are in memory, not localStorage. Media access URLs and state snapshots are not logged. Finder `File` objects are retained until confirmation or dismissal; `getPathForFile` is called immediately before `media.importPaths` to satisfy the preload's one-use grants.

Media `rel` values are literal filesystem-relative paths, never URL-encoded paths. Keep them unchanged in thumbnail requests, selection keys and timeline drag payloads. Use backend-provided playback URLs unchanged; only the backend HTTP boundary decodes URL input. Renderer regressions cover `100% done.mp4`, `take%20one.mp4` and `take one.mp4` as distinct files, but mocked renderer tests do not establish filesystem or HTTP acceptance.

## Handoff status

This is a partial implementation, not completion of T11–T43. Real project creation/opening, timeline persistence and gestures/history, layered playback, Inspector edits, exports, URL downloads, composition runtimes, captions, agent/run screens, Studio, feedback, team editing, audio generation, segmentation and voice input remain unimplemented. Their backend services are not currently exposed. Composition README files reserve integration boundaries; they are not executable hosts/templates.

The folder browser is a separate explicit navigation destination, not the Project Media tab: the backend folder selector does not return a ProjectDoc. Grid/list switching, section collapsing and complete folder-filter controls are not implemented. The compact Inspector currently hides below 1120 px instead of opening the specified sheet. Dock resizing/restoration and complete timeline keyboard collection navigation are also outstanding. These deviations need follow-up before design acceptance.

Validation on 2026-11-01: project typecheck, lint and the renderer tests pass using a planner-approved temporary cached install without the uncached SDK/keyring packages. Repository package files are unchanged; QA's full dependency install remains authoritative. Vite dev-server startup is blocked by a Node-bootstrap exit 134 in the app sandbox. The actual React screens were instead browser-reviewed as a Vite-built static fixture (`tests/renderer/preview`) using simulated, schema-validated bridge responses. This verifies UI states only, not real credentials, macOS Keychain, Terminal launch, executable/model downloads or restart persistence. Real Electron end-to-end acceptance still requires those services and runtime/network permissions.
