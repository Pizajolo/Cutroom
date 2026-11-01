# Cutroom

A macOS video editor built with Electron, React and TypeScript. The app provides a locked-down desktop window, typed IPC, reversible timeline operations, verified automatic media-tool/model downloads, account connections and a tokenized local media service. Agent execution, persistent projects and rendering are not implemented yet. Media binaries are downloaded at runtime rather than checked into this repository.

## Development

Requires Node **22 or newer** and npm. End users of the packaged app will not need either.

```sh
npm install --legacy-peer-deps
npm run dev
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run schemas
```

`npm test` runs both the node and jsdom Vitest projects through Electron's Node (`ELECTRON_RUN_AS_NODE=1`), preserving a single native ABI. A development smoke probe is available with `ELECTRON_RUN_AS_NODE=1 electron scripts/verify-core.mjs` (requires Node's `registerHooks`/type-stripping APIs, Node 22.15+); `--filesystem-only` explicitly omits HTTP when local binding is denied. It does not replace Vitest, typecheck, lint or application acceptance tests. Playwright launches the production build with Electron, not a web-app substitute. `npm run schemas` generates JSON Schema draft-07 artifacts in `docs/schemas/` for agents and tooling. Zod's v3 compatibility entry point is used with zod-to-json-schema.

### Automatic tools and Whisper models

On first launch, FFmpeg/ffprobe **9.0.2** and yt-dlp **2026.10.26** download sequentially in the background. The window opens without waiting. Settings › Tools reports download/verification progress, cancellation, failures and retry. When the tools finish, the default Whisper model (`base`) downloads. Set `CUTROOM_NO_AUTO_DOWNLOAD=1` to disable automatic downloads; manual installation still works. `CUTROOM_HOME` overrides the default `~/.cutroom` for isolated testing.

The v2 manifest in `resources/tools-manifest.json` restricts each source and every redirect to HTTPS allowlisted hosts. Downloads have size/inactivity limits; checksums and Mach-O architectures are verified before executables become available. ZIPs expose only the exact expected member. Private staging directories are removed on failure/cancel/quit. Existing different files are never overwritten. The registry never falls back to Homebrew or `$PATH`.

Tool archive/executable SHA256 pins are currently `null` because the development sandbox denied their sources. In that case runtime installation verifies the archive against the upstream release checksum and records its executable digest in `~/.cutroom/tools/installed.json` (shown as **upstream** verification). Subsequent launches verify against that record and the stat cache; edited bytes become `checksum_mismatch` and cannot run. Files live in `tools/<name>/<version>/<name>`, with optional managed `bin/` symlinks. Bundled pinned files are also eligible. This detects corruption; upstream TLS checksums are not a publisher signature.

Only yt-dlp offers updates. The app checks its fixed GitHub releases endpoint at most daily, validates date-form release tags, and verifies a selected update against that release's `SHA2-256SUMS`. Previous versions remain available on disk until the newer version verifies. Files placed arbitrarily in the tools directory are not eligible.

`npm run fetch:binaries -- --pin` obtains upstream archive checksums, verifies/extracts the expected members and records real archive/executable pins. Review and commit these pins before distributing. Subsequent `npm run fetch:binaries` requires reviewed pins. `--arch=arm64` or `--arch=x64` limits fetching (universal yt-dlp is included). The fetch script never executes downloaded binaries. Development bundles resolve from `resources/bin/<arch>`; packaged bundles are expected in `process.resourcesPath/bin` with the manifest alongside them.

Whisper models (`base`, `small`, `medium`, `large-v3-turbo`) have fixed size/SHA256 pins, live in `~/.cutroom/models/`, and can be downloaded, cancelled, deleted or selected as the persisted default. Deleting a model persists an automatic-download opt-out for that model, including across restarts, without changing the selected default. A successful explicit download clears its opt-out; a failed or cancelled retry does not. Persistent stat verification avoids re-hashing unchanged large models each launch. A modified model is never reported installed.

**whisper-cli requires a local build**, not an untrusted community executable. Install cmake and Xcode Command Line Tools. The official whisper.cpp v1.9.5 source pin is currently unreviewed (`sourceSha256:null`): `npm run build:whisper` fails before any network/build operation. With source access, run `npm run build:whisper -- --pin`, review and commit the printed SHA256, then run `npm run build:whisper` separately. Pin mode never extracts or compiles in the same run. A normal build verifies the source archive, rejects links/traversal, enables embedded Metal and static libraries, and records the resulting `resources/bin/<arch>/whisper-cli` hash. Missing builds show an actionable hint in Tools.

`npm run verify:ffmpeg` checks both architectures' executable pins and native capabilities. Code signing, linked-component notices, complete corresponding source and a distributor-approved source offer remain release blockers; see `resources/licenses/FFmpeg.md`.

### Connecting accounts

Settings › Accounts connects **Claude, OpenAI and ElevenLabs** with API keys. A key is accepted by the provider before storage; only its last four characters are displayed. ElevenLabs reports plan/character usage when the key has `user_read`; keys without that permission can still connect. Verification outages report `unreachable` without deleting keys.

API keys live exclusively in the macOS Keychain: service `dev.cutroom.app`, accounts `anthropic-api-key`, `openai-api-key` and `elevenlabs-api-key`, using `@napi-rs/keyring`. `~/.cutroom/settings.json` holds only credential references and non-secret state, with atomic 0600 writes. A locked/unavailable Keychain or missing native module produces a readable error; there is no plaintext or in-memory fallback. Disconnect removes the Keychain item. To revoke a key independently, revoke it in the provider's API-key dashboard; disconnecting Cutroom does not revoke the provider's credential.

Claude can instead use an existing **official Claude Code** sign-in. Detection prefers the SDK's native optional package, then a fixed list of installed locations. Sign-in opens Terminal running the unmodified binary's `auth login`; Cutroom never receives browser codes or claude.ai tokens. Alternatively run `claude auth login` yourself, then check status and select Claude Code sign-in in Accounts. A failed or timed-out status command is retryable, not evidence of sign-out: saved accounts become `unreachable`, retain their selected method and are verified again on the next startup. Disconnecting Cutroom does not log out the official CLI; run `claude auth logout` in Terminal to do that. Ambient API-key/OAuth/provider-selector variables are stripped from sign-in/status and Claude Code-mode agent environments. The future agent runner can consume `claudeAgentEnv()`; no chat runner is implemented here.

SDK `0.3.316`, keyring `2.1.2` and `@testing-library/dom` `10.4.1` are pinned in `package.json` and the npm-generated `package-lock.json`, including resolved package integrity records. Use `npm install --legacy-peer-deps` for development or `npm ci --legacy-peer-deps` for a clean locked installation. Regenerate lockfiles only through npm, and retain dependency manifest and lockfile changes together. A clean locked installation and native dependency rebuilding passed on macOS arm64. Packaging must unpack `node_modules/@anthropic-ai/claude-agent-sdk-darwin-*/**` from ASAR (no electron-builder distribution config exists yet), and include both architectures' native keyring packages as appropriate.

### Media-only folder browsing

`media.selectProjectFolder` grants access through a native folder picker and stores only an in-memory current folder. This is **not** persistent project creation/opening (T07). `media.list`, explicit imports into `raw`/`references`/`assets`, thumbnail sprites, waveforms, and reveal-in-Finder use that current folder. The tokenized `127.0.0.1` server serves `/k/<launch-token>/p/<folder-id>/<encoded-relative-path>` with GET/HEAD, single byte ranges, no-store and app/dev-only CORS. Selecting another folder revokes the previous HTTP root and cancels its work. The production CSP permits only this exact media origin for media/image/fetch access, not scripts or frames.

Probe/thumbnail/waveform JSON and sprites are cached in `work/.cutroom-media` using source size/mtime/ctime and tool identity. FFmpeg input protocols are limited to file/pipe and standalone demuxers, excluding playlists and network protocols. Media helpers expose progress/cancellation, bounded subprocess output and timeouts; `media.cancel` cancels outstanding work without closing the folder, and quitting aborts/waits for media subprocesses. Imports preflight all sources, retain read-only source descriptors, and exclusively create unique targets; no existing source is overwritten. The preload grants one-use, ten-minute import permission only for paths obtained through `getPathForFile(real File)`; arbitrary absolute path strings are refused before IPC. Native picker imports are handled directly in main. External changes in media folders emit a debounced `media.changed` event. The reusable registry/server/media modules live temporarily under `src/main` and do not import Electron; only startup and IPC wiring do.

## Ownership and boundaries

- **backend-dev**: `src/main`, `src/preload`, `src/shared`, packaging, resources, scripts and Node-side tests.
- **frontend-dev**: `src/renderer` and `src/compositions`.
- **qa**: `tests/e2e`.
- The planned Node-only engine/CLI and native segmentation helper are deferred until their source scopes are available.

The renderer uses `app://cutroom/` in production with a CSP, an isolated sandboxed preload and no Node access. Only `window.cutroom.invoke`, `.on` and `.getPathForFile` cross the bridge. Requests and events are validated against `src/shared/ipc/contract.ts`; errors are structured without internal stacks. Vite supplies the development renderer only.

Project time is in seconds. Timeline positions/durations are quantized to the output frame grid; source in/out remain source seconds. Only video and voiceover tracks forbid overlaps. `applyOp` and `applyOps` are immutable. Public ops are validated with `opSchema`; entity-scoped `restoreItem`, `restoreTrack` (metadata only), `restoreFormat` and `restoreMarker` history records are validated with `historyOpSchema` and must never be accepted as agent requests. History restores exact prior values without quantization or overlap revalidation, and undoing one item does not overwrite later edits to another. Clip crops use source-normalized x/y/w/h within 0..1, positive dimensions and x+w/y+h ≤ 1. Caption word times are relative to the caption item; trims rebase and intersect those intervals with the retained range, removing empty words and clearing highlights that no longer exist. Ripple deletion affects later items on the same track. Inserting a gap inside an item requires splitting it first. JSON merge patches merge nested composition cut IDs and treat `null` as deletion.

Shared project paths and `resolveInProject` accept **literal filesystem names**, never URL-encoded input: `take%20one.mp4` and `take one.mp4` are distinct files, and a literal `%` is valid. The HTTP media boundary decodes each URL path exactly once before resolution; URL generation encodes each literal segment. Resolution rejects literal traversal, absolute paths and symlink escapes. It protects `raw`, `references` and `assets`, including aliases pointing into those folders. Only explicit import flows may opt into source writes. As with any path-based preflight, callers must prevent symlink replacement between resolution and actual file I/O.

Schema examples live under `src/shared/schema/__fixtures__/` (the scaffold fixture location). No source media or generated binary is checked in.
