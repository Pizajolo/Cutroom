# Renderer

Cutroom's React renderer starts at `index.html` / `main.tsx` and imports the designer's unchanged system-appearance tokens before `styles/app.css`.

## Implemented foundation

- Home-first app shell; Zustand navigation, project-session/recent-list state, and a goal draft retained across navigation.
- Typed `lib/api.ts`: unwraps `{ok:true,data}` and constructs renderer-local `IpcFailure` objects for failure envelopes. No production browser bridge mock, direct Node access, or arbitrary shell channel.
- Scoped keymap with text-input, contenteditable, dialog, composition and repeat suppression. Command-N opens/focuses Home without discarding its draft. Native dialogs keep their own keys.
- Media folder browsing through the agreed T08 `media.selectProjectFolder` channel. This is explicitly **not** project creation/opening through T07.
- Five media sections, thumbnail sprites, metadata, inline source video/audio, native file imports, confirmed Finder drops, media change subscriptions, step-specific import progress/cancellation, and relative-path drag payloads (`application/x-cutroom-media`, `{rel}`).
- Tools list/status from T05. Unimplemented updates, model management and licence state are labelled unavailable rather than inferred.
- Reusable transport/master-clock, preview selection, timeline culling/snapping helpers, and an eight-track read-only timeline component. These do not create a second persistence authority.

`tests/renderer` contains Testing Library component tests plus clock, geometry, keymap, API and selection-store tests. The merged web Vitest project includes this directory and uses automatic JSX transformation.

## Integration boundaries

The renderer calls only agreed typed IPC. The backend's T05/T08 media/tools schemas and contract are merged; dependency installation is still required to typecheck the renderer. At this milestone, `project.*`, `timeline.*`, jobs, history, runs, stats, settings, accounts, compositions and voice channels are absent. Corresponding actions are disabled with explanations. A seeded `ProjectSession` can exercise the five-tab editor layout in tests; it must not be mistaken for a project being persisted on disk.

`MasterClock` is dependency-free and testable with an injected scheduler. The Zustand facade is in `editor/preview/store.ts`; transport and playhead subscribe separately. A future media-layer integration must follow that clock and use the visual compositing order (B-roll above Video despite row order). The merged crop schema defines source-normalized coordinates within 0..1, positive dimensions, and containment within the source. Reframe/colour units and export-transform parity still need an agreed implementation; preview/export parity is not claimed.

No secret is accepted by the placeholder Accounts screen. Goal drafts are in memory, not localStorage. Media access URLs and state snapshots are not logged. Finder `File` objects are retained until confirmation or dismissal; `getPathForFile` is called immediately before `media.importPaths` to satisfy the preload's one-use grants.

Media `rel` values are literal filesystem-relative paths, never URL-encoded paths. Keep them unchanged in thumbnail requests, selection keys and timeline drag payloads. Use backend-provided playback URLs unchanged; only the backend HTTP boundary decodes URL input. Renderer regressions cover `100% done.mp4`, `take%20one.mp4` and `take one.mp4` as distinct files, but mocked renderer tests do not establish filesystem or HTTP acceptance.

## Handoff status

This is a partial implementation, not completion of T11–T43. Real project creation/opening, timeline persistence and gestures/history, layered playback, Inspector edits, exports, URL downloads, composition runtimes, captions, agent/run screens, Studio, feedback, team editing, account settings, audio generation, segmentation and voice input remain unimplemented. Their backend services are not currently exposed. Composition README files reserve integration boundaries; they are not executable hosts/templates.

The folder browser is a separate explicit navigation destination, not the Project Media tab: the backend folder selector does not return a ProjectDoc. Grid/list switching, section collapsing and complete folder-filter controls are not implemented. The compact Inspector currently hides below 1120 px instead of opening the specified sheet. Dock resizing/restoration and complete timeline keyboard collection navigation are also outstanding. These deviations need follow-up before design acceptance.

Validation on 2026-11-01: dependency-free assertions for the clock, fractional-frame timecodes, 10,000-item interval culling, snapping and picking pass. Project typecheck fails on missing dependencies; a direct web typecheck stops on missing `vite/client`. Lint cannot find `eslint`, and the web test command cannot find the Vitest runner. Dependency installation was denied by the registry network sandbox. App startup exited with code 134 before serving; no browser screenshots or real Electron/media/import/render E2E acceptance was completed. Local binding also requires sandbox permission for the backend media server. The test sources must still run after dependencies and runtime permissions are available.
