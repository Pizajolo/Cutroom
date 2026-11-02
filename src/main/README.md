# src/main

Electron main process, IPC validation, filesystem safety and media services.

Owner: **backend-dev**.

Reusable Node-only cores belong in `src/engine` (Electron-free and shared by main and the future CLI). That directory is currently outside the backend write scope; keep those cores under `src/main/<area>` without Electron imports until the scope is available. Electron adapters belong in startup and IPC modules only. The existing `@engine` aliases and TypeScript includes reserve the future location; the global no-shell ESLint rule already covers it.

`ipc/startup.ts` is the sole startup registration entry point. New scaffold channels are registered in `ipc/stubs.ts` and resolve typed `unavailable` replies. A build task must remove its channel from that list before registering a real handler; the startup coverage test fails on missing or duplicate handlers.
