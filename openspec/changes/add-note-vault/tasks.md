## 1. OpenSpec
- [x] 1.1 Scaffold proposal.md, tasks.md, design.md, specs/note-vault/spec.md
- [x] 1.2 Run `openspec validate add-note-vault --strict`

## 2. Main-process IPC (electron/main.ts)
- [x] 2.1 `vault:pick` — directory picker
- [x] 2.2 `vault:list` — recursive scan, filter to .md/.markdown/.txt, prune empty dirs, skip hidden & node_modules/.git
- [x] 2.3 `vault:read` — read file content
- [x] 2.4 `vault:create-file` — auto-append `.md`, resolve conflicts with `-1` / `-2` suffix
- [x] 2.5 `vault:create-folder` — mkdir, conflict check
- [x] 2.6 `vault:rename` — rename with same-vault & conflict validation
- [x] 2.7 `vault:delete` — `shell.trashItem` with error fallback
- [x] 2.8 `vault:watch` recursive + `vault:changed` event pushed to renderer (debounced 150ms)
- [x] 2.9 `vault:get-last` / `vault:set-last` backed by `userData/vault.json`
- [x] 2.10 Path-escape guard helper used by every write/read handler

## 3. Preload + Types
- [x] 3.1 Extend preload.ts with `nexusDemo.vault.*`
- [x] 3.2 Extend bridge.d.ts with `VaultNode` and `VaultBridge` types

## 4. Renderer
- [x] 4.1 Extend `AppState` with `vaultPath`, `vaultTree`, `activeFile`
- [x] 4.2 New `vault-panel.ts`: render tree, folding, active-file highlight
- [x] 4.3 Click-to-switch file with dirty-state confirm
- [x] 4.4 "New file" / "New folder" buttons in panel header
- [x] 4.5 Right-click context menu: rename, delete, new sibling
- [x] 4.6 Inline rename (dblclick → contentEditable → Enter commit / Esc cancel)
- [x] 4.7 Subscribe to `vault:changed`, debounced re-list
- [x] 4.8 On boot: restore last vault and re-open last active file if present
- [x] 4.9 Integrate into `app.ts` layout (Vault button + panel placement)

## 5. Verify
- [x] 5.1 `pnpm --filter @floatboat/nexus-electron-demo build` passes
- [x] 5.2 `pnpm -w run test` passes (135/135, no regressions)
- [x] 5.3 `openspec validate add-note-vault --strict` passes
- [ ] 5.4 Manual end-to-end smoke test covering all scenarios in the spec (to be performed by user in electron UI)
