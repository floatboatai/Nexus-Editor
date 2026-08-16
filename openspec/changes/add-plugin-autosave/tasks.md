# Implementation Tasks

## 1. Package scaffolding

- [x] 1.1 Create `packages/plugin-autosave/` with `package.json`
  (matching the shape of `packages/plugin-wordcount/package.json`:
  `tsup` build script, `@floatboat/nexus-core` workspace dep,
  `publishConfig` set to public npm, `version: 0.0.14`).
- [x] 1.2 Create `packages/plugin-autosave/tsconfig.json` extending
  `../../tsconfig.base.json` and `include`-ing `src/**/*.ts` +
  `test/**/*.ts`.
- [x] 1.3 Add the alias `"@floatboat/nexus-plugin-autosave":
  ["packages/plugin-autosave/src/index.ts"]` to `tsconfig.base.json`
  `paths`.
- [x] 1.4 Add the matching alias to `vitest.config.ts`
  `resolve.alias` (inserted before the reference-plugins alias line).
- [x] 1.5 Append `&& pnpm --filter @floatboat/nexus-plugin-autosave
  build` to the root `package.json` `build` script (before the
  reference-plugins build).

## 2. Debounce scheduler (`src/scheduler.ts`)

- [x] 2.1 Implement `createDebouncedTask(options:
  DebouncedTaskOptions): DebouncedTask` — a pure, environment-agnostic
  debounce with `schedule`, `flush`, `cancel`, `destroy`, and `pending`
  / `running` getters.
- [x] 2.2 `schedule()` (re)starts the timer; calls within the window
  collapse to a single run. Timer primitives (`scheduleFn` /
  `clearFn`) are injectable for fake-timer testing and idle-time
  coalescing.
- [x] 2.3 `flush()` runs any pending task immediately and resolves to
  `true` if it ran, `false` if nothing was pending; it **awaits** the
  async `run` so callers can rely on the write having finished.
- [x] 2.4 `cancel()` drops a pending run without executing it;
  `destroy()` clears timers and makes all further calls no-ops.
- [x] 2.5 The fire-and-forget timer path swallows rejections
  (`void runNow().catch(noop)`) so a failing `run` never produces an
  unhandled rejection; `flush()` surfaces the error to its awaiter
  instead.

## 3. Plugin factory (`src/index.ts`)

- [x] 3.1 Export `createAutosavePlugin(options:
  AutosaveOptions): AutosavePlugin`. Throws `TypeError` when
  `options.onSave` is not a function.
- [x] 3.2 Resolve options: `delay?: number = 800` (clamped to `>= 0`),
  `onSave: (doc) => void | Promise<void>` (required).
- [x] 3.3 `attachEditor(editor)` captures the loaded document as the
  clean baseline (`lastSavedDoc = editor.getDocument()`) so a fresh
  editor is not flagged dirty, then subscribes to `change`.
- [x] 3.4 On every `change`, `schedule()` a save. `performSave`
  skips the write when the live `doc` equals `lastSavedDoc` (no-op
  save avoided), sets a `saving` flag around the `await onSave`, and
  updates `lastSavedDoc` only on success.
- [x] 3.5 `getState()` returns `{ dirty, pending, saving }` where
  `dirty = editor !== null && lastSavedDoc !== null && current !==
  lastSavedDoc`; `pending` / `saving` come from the scheduler.
- [x] 3.6 `flush()` delegates to the scheduler and returns whether a
  save ran; `cancel()` drops a pending timer but keeps dirty state;
  `destroy()` detaches the `change` listener, clears timers, nulls the
  editor reference, and is idempotent.
- [x] 3.7 On `destroy` / `detach`, a rejection in `onSave` leaves the
  document dirty (a later edit retries) and never crashes the editor.
- [x] 3.8 `attachEditor` is idempotent (repeat calls ignored) and
  `destroy` is guarded against a torn-down editor (`editor.off` wrapped
  in try/catch).

## 4. Public exports (`src/index.ts`)

- [x] 4.1 Re-export `createAutosavePlugin`, `attachAutosavePlugin`,
  `AutosaveOptions`, `AutosaveState`, `AutosaveAPI`, `AutosavePlugin`.
- [x] 4.2 Re-export `createDebouncedTask` and the `DebouncedTask` /
  `DebouncedTaskOptions` types so the scheduler is usable standalone.

## 5. Tests

- [x] 5.1 `test/scheduler.test.ts` (pure, fake timers, 10 cases):
  debounce collapse, flush returns true after a scheduled run / false
  when nothing pending, cancel prevents run, running flag during async
  run, awaiting an async `run` before flush resolves, `delay = 0`
  still defers to a microtask, destroy prevents further runs, repeated
  flush is safe, order of schedule→flush→schedule, destroy is
  idempotent.
- [x] 5.2 `test/index.test.ts` (jsdom + mock editor, 11 cases):
  throws without `onSave`; no save of the initial document on attach;
  saves the latest document after the debounce window; rapid edits
  collapse to a single save; `flush()` returns `true` when dirty and
  `false` when clean; `cancel()` keeps the document dirty; async
  `onSave` clears dirty only after resolution; a rejected `onSave`
  leaves dirty for retry; `destroy()` detaches the listener;
  idempotent `attachEditor`; state exposes `pending` / `saving`.

## 6. Documentation

- [x] 6.1 `packages/plugin-autosave/README.md` — install, vanilla /
  React / Vue usage, full options + types reference, design notes
  (baseline capture, dirty tracking, async safety), and failure /
  retry semantics.
- [x] 6.2 Top-level `README.md` plugin table — add a row for
  `@floatboat/nexus-plugin-autosave`. Same for `README.zh.md`.
- [x] 6.3 `docs/ROADMAP.md` — add a row under "9. Developer
  Experience" with status `done` (toggles once merged). Same for
  `docs/ROADMAP.zh.md`.
- [x] 6.4 `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` — add `autosave` to
  the scope whitelist row mapping it to `packages/plugin-autosave`.

## 7. Verify

- [x] 7.1 `pnpm install --ignore-scripts` — workspace recognises the
  new package (lockfile updated, clean diff).
- [x] 7.2 `pnpm -r --filter @floatboat/nexus-plugin-autosave exec tsc
  --noEmit` — typecheck clean (runs against source via the new alias).
- [x] 7.3 `pnpm test` — 21 / 21 new autosave tests pass; full suite
  **919 tests passed (70 files)**, no regressions.
- [x] 7.4 `pnpm --filter @floatboat/nexus-plugin-autosave build` —
  `dist/index.js` + `dist/index.d.ts` emit cleanly; root `build`
  (which now includes the package) succeeds for `core` + `autosave`.
- [ ] 7.5 `openspec validate add-plugin-autosave --strict` — CLI not
  installed in the dev environment. Spec format hand-linted against
  `openspec/AGENTS.md` §"Spec File Format" (each `### Requirement:`
  has at least one `#### Scenario:` with `**WHEN**` / `**THEN**`
  bullets; delta files use `## ADDED Requirements`).
