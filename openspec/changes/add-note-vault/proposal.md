# Change: Add Note Vault (Repository) to Electron Demo

## Why

The electron demo currently only supports opening one file at a time via a file-picker. Users who want to work on a collection of notes (Obsidian-style) must reopen files individually, have no visible file tree, and cannot create/rename/delete notes from the app. A "vault" (working directory) abstraction is the minimum viable surface for real note-taking use.

## What Changes

- Add a Vault concept to the electron demo: a user-selected root directory whose markdown files form a navigable, editable tree.
- New main-process IPC channels: `vault:pick`, `vault:list`, `vault:read`, `vault:create-file`, `vault:create-folder`, `vault:rename`, `vault:delete`, `vault:watch` / `vault:changed`, `vault:get-last`, `vault:set-last`.
- New renderer component `vault-panel.ts` rendered alongside the existing outline panel.
- Persist the last opened vault in `userData/vault.json` and auto-restore on launch.
- Watch the vault via `fs.watch` (recursive) and refresh the tree on external changes.
- Dirty-state guard when switching files in the tree.
- File-type filter: only `.md`, `.markdown`, `.txt` are shown (and empty parent directories are pruned).
- Path-escape guard: all file-system IPC validates that the target path resolves inside the active vault.
- **No changes to `@floatboat/nexus-core`** — the core editor remains path-agnostic; vault is host-side only.

## Impact

- Affected specs: `note-vault` (new capability)
- Affected code:
  - `apps/electron-demo/electron/main.ts` (IPC + watcher + persistence)
  - `apps/electron-demo/electron/preload.ts` (bridge)
  - `apps/electron-demo/src/renderer/bridge.d.ts` (types)
  - `apps/electron-demo/src/renderer/state.ts` (state fields)
  - `apps/electron-demo/src/renderer/app.ts` (layout + toolbar + switching)
  - `apps/electron-demo/src/renderer/vault-panel.ts` (new)
  - `apps/electron-demo/src/renderer/style.css` (new styles)
- No new runtime dependencies; uses `electron.shell.trashItem` and node `fs.watch`.
- Back-compat: existing Open / Save / Save As single-file flow keeps working when no vault is open.
