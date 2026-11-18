# App icon

- `logo-mark-on-light.svg` — deep blue mark with a white glyph, for light surfaces (light appearance).
- `logo-mark.svg` — pale mark with a dark glyph, for dark surfaces (dark appearance).

Made from them (all in `resources/`):

- `dock-light.png`, `dock-dark.png` — 1024 px on Apple's icon grid (824 px shape, soft shadow). Cutroom sets the
  Dock icon to the one matching the macOS appearance while it runs (`showIcon` in `src/main/index.ts`).
- `icon-light.png`, `icon-dark.png` — 512 px, full bleed: the window icon on Windows and Linux.
- `icon.icns` (macOS, light mark on the grid) and `icon.ico` (Windows) — for the packaged app, e.g. electron-builder's
  `mac.icon` / `win.icon`.
