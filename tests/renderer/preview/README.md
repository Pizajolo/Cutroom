# Isolated renderer browser fixture

This opt-in fixture imports the real React app and designer styles. Its typed bridge returns schema-validated **simulated** accounts, downloads and model state. It never contacts a provider, accesses Keychain, launches Terminal, saves credentials or downloads real tools. Do not enter real API keys. It is not imported by the production entrypoint.

With dependencies installed, build from the repository root:

```sh
node --input-type=module -e 'import {build} from "vite"; await build({configFile:false,root:"tests/renderer/preview",base:"./",resolve:{alias:{"@shared":process.cwd()+"/src/shared"}},esbuild:{jsx:"automatic"},build:{outDir:"../preview-dist",emptyOutDir:true}});'
```

Serve the generated `tests/renderer/preview-dist` directory with a static server, or open `tests/renderer/preview-dist/index.html` with the covibe browser file-serving tool. The assets use relative paths. `?section=Tools` opens Tools directly. Generated output is disposable and must not be committed.

The fixture lets a reviewer exercise API-key submission/focus, confirmation dialogs, the explicit Claude Code sign-in handoff (simulated detection after a few seconds), model downloads/cancel, yt-dlp updates and live Sidebar/Home summaries. Provider rejection, offline, race and polling-timeout cases are covered by the adjacent component tests. Actual provider credentials, native storage, installer security and persistence require separate Electron/backend QA.
