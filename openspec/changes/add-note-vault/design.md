## Context

The electron-demo app currently treats every editing session as a single untitled or opened file. Notes-app workflows require a persistent working directory where multiple markdown files can be browsed, created, organized, and switched between. We need to introduce this concept without compromising the core editor's single-document, path-agnostic design.

## Goals / Non-Goals

**Goals:**
- A user-selected root directory (the "vault") becomes the scope for a browsable file tree.
- Full CRUD on markdown files and folders inside that vault, plus live sync with external filesystem changes.
- The last opened vault and last active file are restored on launch.
- Existing single-file Open/Save/Save As flow continues to work unchanged.

**Non-Goals:**
- Multi-tab editing (only one file active at a time).
- Drag-and-drop reordering, attachments, search indexing, sync, or collaboration.
- Changes to `@floatboat/nexus-core` or any other shared package.
- Multiple simultaneous vaults.

## Decisions

**Decision: Keep vault logic entirely in `apps/electron-demo`, zero changes to `@floatboat/nexus-core`.**
The core already exposes `setDocument(markdown)` which is all that's needed to swap document contents. Adding vault types to core would pollute its single-document semantics and couple it to an electron-specific concern.
Alternatives considered: (a) a `Workspace` abstraction in core — rejected as it would leak host concerns into the reusable engine; (b) a new `@floatboat/nexus-workspace` package — overkill for one host implementation, can be extracted later if other hosts (web, mobile) need it.

**Decision: Use node `fs.watch` with `{ recursive: true }`, not chokidar.**
Zero new dependencies; recursive mode is reliable on macOS and Windows. Linux recursive support is incomplete, so we accept that users may need manual refresh on Linux for deep changes. If that becomes a real complaint, we can introduce chokidar later behind the same IPC interface.

**Decision: Persist last-vault state via a plain JSON file in `app.getPath("userData")/vault.json`.**
Avoids pulling in `electron-store`. Single file, single read/write. Survives app restarts.

**Decision: `shell.trashItem` for deletion, not `fs.unlink`.**
Aligns with Obsidian/Finder expectations — destructive operations go through the OS trash, recoverable.

**Decision: Path-escape guard on every filesystem handler.**
All write/read paths resolve and check `path.relative(vault, target)` to reject `..` escapes. A malicious/compromised renderer must not be able to touch files outside the active vault through our IPC.

**Decision: Filter the tree to `.md`, `.markdown`, `.txt` only.**
Directly answers the user's stated preference. Empty parent directories (those with no matching descendants) are pruned from the tree so the view stays clean.

## Risks / Trade-offs

- **Linux recursive watch gaps** → accept with manual refresh; revisit if friction reported.
- **Large vault (>1000 files) scan cost** → full recursion on first load is acceptable for a demo; future optimization could lazy-load subtrees.
- **External rename of the active file** → watcher detects disappearance; UI shows a warning instead of silently losing the editor state.
- **Trash API unavailable in some Linux environments** → catch the error and surface it to the user rather than falling back to a hard delete by default.

## Migration Plan

Not applicable — net-additive. Existing single-file IPC channels (`demo:open-file`, `demo:save-file`, `demo:save-file-as`) stay intact. `AppState.filePath` is retained during the transition; `activeFile` mirrors it when a vault is open.

## Open Questions

- Should the vault panel be toggleable like the outline panel? (Proposed: yes, same `☰`-style toggle, default visible when a vault is open.)
- Should we show a "Recent Vaults" submenu? (Proposed: scope creep for v1 — we store `recents` in `vault.json` but only surface `lastVault` for auto-restore this round.)
