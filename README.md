# Cutroom

A macOS video editor built with Electron, React and TypeScript. The scaffold provides a locked-down desktop window, typed IPC, shared project schemas and reversible timeline operations. Media tools and agent execution are not implemented yet.

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

`npm test` runs both the node and jsdom Vitest projects through Electron's Node (`ELECTRON_RUN_AS_NODE=1`), preserving a single native ABI. Playwright launches the production build with Electron, not a web-app substitute. `npm run schemas` generates JSON Schema draft-07 artifacts in `docs/schemas/` for agents and tooling. Zod's v3 compatibility entry point is used with zod-to-json-schema.

`fetch:binaries` and `verify:ffmpeg` are explicit scaffold stubs. They do not download or verify anything; the verifier exits unsuccessfully until real verification is implemented.

## Ownership and boundaries

- **backend-dev**: `src/main`, `src/preload`, `src/shared`, packaging, resources, scripts and Node-side tests.
- **frontend-dev**: `src/renderer` and `src/compositions`.
- **qa**: `tests/e2e`.
- The planned Node-only engine/CLI and native segmentation helper are deferred until their source scopes are available.

The renderer uses `app://cutroom/` in production with a CSP, an isolated sandboxed preload and no Node access. Only `window.cutroom.invoke`, `.on` and `.getPathForFile` cross the bridge. Requests and events are validated against `src/shared/ipc/contract.ts`; errors are structured without internal stacks. Vite supplies the development renderer only.

Project time is in seconds. Timeline positions/durations are quantized to the output frame grid; source in/out remain source seconds. Only video and voiceover tracks forbid overlaps. `applyOp` and `applyOps` are immutable. Public ops are validated with `opSchema`; entity-scoped `restoreItem`, `restoreTrack` (metadata only), `restoreFormat` and `restoreMarker` history records are validated with `historyOpSchema` and must never be accepted as agent requests. History restores exact prior values without quantization or overlap revalidation, and undoing one item does not overwrite later edits to another. Caption word times are relative to the caption item. Ripple deletion affects later items on the same track. Inserting a gap inside an item requires splitting it first. JSON merge patches merge nested composition cut IDs and treat `null` as deletion.

`resolveInProject` rejects traversal, encoded traversal, absolute paths and symlink escapes. It protects `raw`, `references` and `assets`, including aliases pointing into those folders. Only explicit import flows may opt into source writes. As with any path-based preflight, callers must prevent symlink replacement between resolution and actual file I/O.

Schema examples live under `src/shared/schema/__fixtures__/` (the scaffold fixture location). No source media or generated binary is checked in.
