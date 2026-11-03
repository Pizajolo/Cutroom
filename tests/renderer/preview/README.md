# Isolated renderer browser fixture

This opt-in fixture imports the real React app and designer styles. Its typed bridge returns schema-validated **simulated** accounts, downloads and model state. It never contacts a provider, accesses Keychain, launches Terminal, saves credentials or downloads real tools. Do not enter real API keys. It is not imported by the production entrypoint.

With dependencies installed, build from the repository root:

```sh
node --input-type=module -e 'import {build} from "vite"; await build({configFile:false,root:"tests/renderer/preview",base:"./",resolve:{alias:{"@shared":process.cwd()+"/src/shared"}},esbuild:{jsx:"automatic"},build:{outDir:"../preview-dist",emptyOutDir:true}});'
```

Serve the generated `tests/renderer/preview-dist` directory with a static server, or open `tests/renderer/preview-dist/index.html` with the covibe browser file-serving tool. The assets use relative paths. `?section=Tools` opens Tools directly. Generated output is disposable and must not be committed.

The fixture lets a reviewer exercise API-key submission/focus, confirmation dialogs, the explicit Claude Code and Codex sign-in handoffs (simulated detection after a few seconds), model downloads/cancel, yt-dlp updates, settings drafts, cleanup reviews, MCP review and live Sidebar/Home summaries. All requests and successful responses pass through the actual IPC schemas. Unsupported fixture operations return unavailable rather than claiming a successful native action.

Routes: `?section=Sandbox`, `?section=Voice%20input`, `?section=Render%20presets`, `?section=Storage%20%2F%20snapshots`, `?section=Extensions`, `?project&editor`, and `?project&home`. The project route has a timeline but no playable source files, so its black preview is deliberate; it cannot establish real playback or export correctness.

## Live browser and opaque-frame probe

Start through covibe `app_start`, with setup `true` (dependencies already installed), and this command:

```sh
node --input-type=module -e 'import {createServer} from "vite"; const server=await createServer({configFile:false,root:"tests/renderer/preview",resolve:{alias:{"@shared":process.cwd()+"/src/shared"}},esbuild:{jsx:"automatic"},server:{host:"127.0.0.1",port:Number(process.env.PORT),strictPort:true,cors:{origin:["null",/^http:\/\/127\.0\.0\.1:\d+$/]}}}); await server.listen();'
```

The `null` CORS origin is **test-only**, needed for Vite modules inside the opaque sandboxed `bridge.html`. Production composition resources are served by main with its own token/origin policy. Never enable `allow-same-origin` to make this test pass.

On 2026-11-02 a real Chromium probe imported `CompositionBridge`, created an iframe with exactly `sandbox="allow-scripts"`, loaded `bridge.html`, sent a `load` request containing title text `Coast at dawn`, sought to 1 second and requested `domSnapshot`. The response reported `{loaded:true}` and the title element text `Coast at dawn`; accessing the frame document remained blocked (opaque origin). The probe disposed its private port and removed the frame. The initial attempt timed out because the dev module server did not allow origin `null`; the narrowly scoped fixture CORS above resolved that, without changing production policy. Deterministic wrong-origin/nonce/source, private-port, reload, malformed-command and timeout cases are in `CompositionBridge.test.ts`.

Responsive screenshots were inspected at 1440×900, 1280×800, 1024×768 and 390×844 across the editor/settings checks on 2026-11-02–03. Compact editor disclosures focus the active tab; Escape restores the disclosure button. Narrow dialogs keep their action footer visible while their body scrolls. Restart this isolated server if external source edits are not reflected in its module cache.

Provider rejection, offline, race and polling-timeout cases are covered by adjacent component tests. Actual provider credentials, microphone hardware, native storage, installer security, restart persistence, media continuity and final exported pixels require separate Electron/backend QA. These simulated services are not proof of those behaviors.
