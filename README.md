# Cutroom

A macOS video editor built with Electron, React and TypeScript. The app foundations provide a locked-down desktop window, typed IPC, shared project schemas, reversible timeline operations, a verified-tool registry and a tokenized local media service. Agent execution, persistent projects and rendering are not implemented yet. Bundled media binaries are **not installed or verified** in this checkout.

## Development

Requires Node **22 or newer** and npm. End users of the packaged app will not need either.

```sh
npm install
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run schemas
```

`npm test` runs both the node and jsdom Vitest projects through Electron's Node (`ELECTRON_RUN_AS_NODE=1`), preserving a single native ABI. A dependency-free development smoke probe is available with `ELECTRON_RUN_AS_NODE=1 electron scripts/verify-core.mjs` (requires Node's `registerHooks`/type-stripping APIs, Node 22.15+); `--filesystem-only` explicitly omits HTTP when local binding is denied. It does not replace Vitest, typecheck, lint or application acceptance tests. Playwright launches the production build with Electron, not a web-app substitute. `npm run schemas` generates JSON Schema draft-07 artifacts in `docs/schemas/` for agents and tooling. Zod's v3 compatibility entry point is used with zod-to-json-schema.

### Bundled tools (release gate not yet satisfied)

`resources/tools-manifest.json` identifies FFmpeg/ffprobe 9.0.2 releases for arm64 and x64. Its SHA256 fields are deliberately `null`: the binary host was denied by the development sandbox, so no checksum has been invented. Runtime resolution fails closed for an executable without a known digest and never falls back to Homebrew or `$PATH`.

Once the binary source is permitted, `npm run fetch:binaries -- --pin` obtains the upstream archive checksum, verifies the archive, reads only the expected ZIP member, checks its Mach-O architecture, and records the executable digest. Review and commit these initial TLS/upstream-derived pins before distribution. Subsequent `npm run fetch:binaries` requires the existing pins and refuses different existing binaries. `--arch=arm64` or `--arch=x64` limits fetching. Downloads use private temporary directories and are never executed by the fetch script.

`npm run verify:ffmpeg` verifies both architectures' executable hashes and, on macOS, checks the native version, system-only dynamic linkage, GPL/non-nonfree build configuration, required encoders and filters. It exits unsuccessfully for missing pins or binaries. Code signing, all linked-component notices, complete corresponding source, and a distributor-approved source offer remain release blockers; see `resources/licenses/FFmpeg.md`.

The registry uses `CUTROOM_HOME` (default `~/.cutroom`) for `tools-cache.json`, versioned verified updates in `tools/<name>/<version>/<name>` and optional managed symlinks in `bin/`. Only versions/digests in the application manifest are eligible; unsigned sidecar manifests in an update directory are not trusted. Mark update-only pins `bundled:false`. Development bundles resolve from `resources/bin/<arch>`; packaged bundles are expected under `process.resourcesPath/bin` with the manifest alongside them (packaging is deferred).

### Media-only folder browsing

`media.selectProjectFolder` grants access through a native folder picker and stores only an in-memory current folder. This is **not** persistent project creation/opening (T07). `media.list`, explicit imports into `raw`/`references`/`assets`, thumbnail sprites, waveforms, and reveal-in-Finder use that current folder. The tokenized `127.0.0.1` server serves `/k/<launch-token>/p/<folder-id>/<encoded-relative-path>` with GET/HEAD, single byte ranges, no-store and app/dev-only CORS. Selecting another folder revokes the previous HTTP root and cancels its work. The production CSP permits only this exact media origin for media/image/fetch access, not scripts or frames.

Probe/thumbnail/waveform JSON and sprites are cached in `work/.cutroom-media` using source size/mtime/ctime and tool identity. FFmpeg input protocols are limited to file/pipe and standalone demuxers, excluding playlists and network protocols. Media helpers expose progress/cancellation, bounded subprocess output and timeouts; `media.cancel` cancels outstanding work without closing the folder, and quitting aborts/waits for media subprocesses. Imports preflight all sources, retain read-only source descriptors, and exclusively create unique targets; no existing source is overwritten. The preload grants one-use, ten-minute import permission only for paths obtained through `getPathForFile(real File)`; arbitrary absolute path strings are refused before IPC. Native picker imports are handled directly in main. External changes in media folders emit a debounced `media.changed` event. The reusable registry/server/media modules live temporarily under `src/main` and do not import Electron; only startup and IPC wiring do.

## Ownership and boundaries

- **backend-dev**: `src/main`, `src/preload`, `src/shared`, packaging, resources, scripts and Node-side tests.
- **frontend-dev**: `src/renderer` and `src/compositions`.
- **qa**: `tests/e2e`.
- The planned Node-only engine/CLI and native segmentation helper are deferred until their source scopes are available.

The renderer uses `app://cutroom/` in production with a CSP, an isolated sandboxed preload and no Node access. Only `window.cutroom.invoke`, `.on` and `.getPathForFile` cross the bridge. Requests and events are validated against `src/shared/ipc/contract.ts`; errors are structured without internal stacks. Vite supplies the development renderer only.

Project time is in seconds. Timeline positions/durations are quantized to the output frame grid; source in/out remain source seconds. Only video and voiceover tracks forbid overlaps. `applyOp` and `applyOps` are immutable. Public ops are validated with `opSchema`; entity-scoped `restoreItem`, `restoreTrack` (metadata only), `restoreFormat` and `restoreMarker` history records are validated with `historyOpSchema` and must never be accepted as agent requests. History restores exact prior values without quantization or overlap revalidation, and undoing one item does not overwrite later edits to another. Caption word times are relative to the caption item. Ripple deletion affects later items on the same track. Inserting a gap inside an item requires splitting it first. JSON merge patches merge nested composition cut IDs and treat `null` as deletion.

`resolveInProject` rejects traversal, encoded traversal, absolute paths and symlink escapes. It protects `raw`, `references` and `assets`, including aliases pointing into those folders. Only explicit import flows may opt into source writes. As with any path-based preflight, callers must prevent symlink replacement between resolution and actual file I/O.

Schema examples live under `src/shared/schema/__fixtures__/` (the scaffold fixture location). No source media or generated binary is checked in.
