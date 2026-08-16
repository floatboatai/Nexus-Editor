# Change: Add `@floatboat/nexus-plugin-autosave` — local-first, debounced autosave

## Why

Nexus positions itself as a **local-first** Markdown editor (the README
compares against Tiptap / Lexical / Milkdown and scores Nexus `✅
First-class` on *Local-first / file IO hooks* — see `README.md:47`). But
the engine ships no out-of-the-box way to persist the document. A host
that wants "my file saves itself a second after I stop typing" has to
wire `editor.on("change", ...)` to its own debounce loop, replaying the
same fragile boilerplate every integration:

- **Naive debounce loses the last keystroke.** The common
  `setTimeout`-on-every-change pattern fires only after a *quiet
  period*; if the editor unmounts mid-typing (route change, tab close),
  the pending timer is dropped and the final edit is lost. Guarding
  every teardown with a `flush()` is easy to forget.
- **Dirty state is re-invented everywhere.** Hosts compare `doc` to a
  last-saved snapshot by hand, or — worse — re-save identical content on
  every pause, burning disk / IPC / network on a no-op write.
- **Async writes race.** A slow `fs.writeFile` or `fetch` overlaps the
  next edit's save; without explicit awaiting, the two can interleave
  and the persisted file ends up stale.

These are the same cross-cutting concerns that `plugin-history`,
`plugin-search`, and `plugin-wordcount` already solve *as plugins* rather
than in core. Autosave belongs in that family: it is opt-in (a comment
box shouldn't auto-persist), headless (no UI required — a status-bar
affordance is intentionally *out of scope* for v1), and depends only on
the public editor event API.

By landing `@floatboat/nexus-plugin-autosave`, a host gets
debounce-with-flush, dirty tracking, and async-safe saving in one import
instead of re-implementing it.

## What Changes

- **New package `@floatboat/nexus-plugin-autosave`** under
  `packages/plugin-autosave/`. Public surface:
  - `createAutosavePlugin(options) → AutosavePlugin` — the factory.
    Requires `options.onSave` (throws `TypeError` otherwise). Returns a
    `NexusPlugin` *plus* an API handle (`getState`, `flush`, `cancel`,
    `destroy`) and an `attachEditor(editor)` method, mirroring the
    established `plugin-wordcount` convention (the `NexusPlugin` contract
    is declarative, so plugins bind to a concrete editor instance after
    `createEditor` returns).
  - `attachAutosavePlugin(plugin, editor)` — free-function equivalent of
    `plugin.attachEditor(editor)`; the recommended call-site form
    (matches `attachWordCountPlugin`).
  - `AutosaveOptions { delay?: number = 800; onSave: (doc: string) =>
    void | Promise<void> }`.
  - `AutosaveState { dirty: boolean; pending: boolean; saving:
    boolean }` — observable save lifecycle for any host UI.
  - `AutosaveAPI` (the handle) and `AutosavePlugin` types.
  - `createDebouncedTask(options) → DebouncedTask` (re-exported) — the
    pure, environment-agnostic debounce scheduler that the plugin is
    built on; also usable standalone.
- **Mount on the existing public API only** — no core changes. The
  plugin uses `editor.on("change", ...)`, `editor.off("change", ...)`,
  and `editor.getDocument()`. No new exports from
  `@floatboat/nexus-core`.
- **Workspace integration** — `tsconfig.base.json` path alias,
  `vitest.config.ts` resolve alias, root `package.json` build script,
  README plugin table row, CONTRIBUTING scope whitelist row
  (`autosave`), ROADMAP entry under DX.
- **Clean / dirty baseline** — on `attachEditor`, the currently loaded
  document is captured as the clean baseline, so a fresh editor is never
  flagged dirty and the initial load does *not* trigger a save.

No breaking changes. The core editor API is untouched; the plugin only
*consumes* it.

## Impact

- Affected specs:
  - `autosave` (NEW capability) — debounce-with-flush contract, dirty
    tracking semantics, async-write safety, attach/detach lifecycle,
    failure/retry behaviour.
- Affected code:
  - `packages/plugin-autosave/` (NEW package — `src/index.ts`,
    `src/scheduler.ts`, `README.md`, `package.json`, `tsconfig.json`,
    `test/index.test.ts`, `test/scheduler.test.ts`).
  - `tsconfig.base.json` (path alias).
  - `vitest.config.ts` (resolve alias).
  - `package.json` (root `build` script adds the new package).
  - `pnpm-workspace.yaml` untouched — already globs `packages/*`.
  - `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` (scope whitelist row
    `autosave`).
  - `docs/ROADMAP.md` / `docs/ROADMAP.zh.md` (new row under DX).
  - `README.md` / `README.zh.md` (plugin table row, brief example).
- New external dependencies: **none**. The package depends only on
  `@floatboat/nexus-core` (workspace).
- Out of scope (explicit non-goals):
  - **Status-bar / "saving…" UI.** The plugin exposes a fully observable
    `AutosaveState` (`dirty` / `pending` / `saving`) precisely so a host
    can render its own indicator, but v1 ships no DOM. This keeps the
    plugin framework-agnostic and matches the wordcount precedent's
    "opt-in UI" stance without forcing a widget every host must hide.
  - **Conflict resolution / versioning of the saved file.** The plugin
    persists the latest `doc`; merging concurrent edits is the host's
    responsibility (e.g. an LWW file or a CRDT layer).
  - **Periodic flush on a wall-clock interval.** Only debounce + explicit
    `flush()` exist; an interval timer would race with the user's intent
    on long pauses and is intentionally absent.
  - **Batch / transaction coalescing beyond debounce.** Multiple edits
    inside one debounce window already collapse to a single save — that
    is the only coalescing this plugin performs.
