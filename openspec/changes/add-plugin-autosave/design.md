## Context

Two facts about Nexus shape this design:

1. The `NexusPlugin` contract (`packages/core/src/types.ts`) is
   **declarative**: a plugin declares `name`, `shortcuts`,
   `slashCommands`, `commands`, `handlers`, `remarkPlugins`,
   `cmExtensions`, `widgets`. There is no `init` hook, and core does
   **not** auto-attach a plugin to the editor instance. The established
   convention (from `plugin-wordcount`) is a manual
   `attachEditor(editor)` method on the returned object plus an
   `attachXxxPlugin(plugin, editor)` free function. Autosave follows
   the same idiom so reviewers see a familiar shape.
2. The editor already emits a `change` event and exposes the live
   document via `editor.getDocument()`; it does **not** track dirty state
   or provide debounce. Those concerns are exactly what a plugin should
   own, not something to push into the (already lean) core.

The goal is a *drop-in* autosave that a local-first host can wire up in
three lines and then forget about — while staying headless, dependency-
free, and fully unit-testable without a CodeMirror instance.

## Goals / Non-Goals

- **Goals**
  - Debounce-with-flush: edits collapse to one save per pause; an
    explicit `flush()` persists immediately and is awaitable.
  - Dirty tracking via a last-saved document snapshot, so redundant
    writes are skipped and `flush()` is a no-op on a clean doc.
  - Async-write safety: a slow `onSave` is awaited; overlapping saves
    cannot interleave.
  - Teardown correctness: `destroy()` detaches the listener and is
    idempotent; a rejected `onSave` leaves the doc dirty for retry.
  - Zero new external dependencies; mount on the public event API only.
  - Fully headless-testable (jsdom + a mock editor), no real timer or
    DOM required for the bulk of the coverage.
- **Non-Goals**
  - A status-bar / "saving…" widget — `AutosaveState` is exposed for
    hosts to render their own; no DOM ships in v1.
  - Conflict resolution or file-versioning — host responsibility.
  - A wall-clock interval flush — only debounce + explicit `flush()`.

## Decisions

### Decision 1: New plugin package, not a core enhancement

`@floatboat/nexus-plugin-autosave` lives in `packages/plugin-autosave/`,
mirroring `plugin-wordcount` exactly: ESM-only `tsup` build, workspace
dep on `@floatboat/nexus-core`, no deps on other plugins.

**Alternatives considered:**

- *Add autosave to core.* Core is a lean engine; an editor embedded in a
  comment box or a chat input must not auto-persist. Opt-in via plugin
  keeps the default cost at zero. Rejected.
- *Fold it into `plugin-history`.* History owns undo/redo; mixing in
  persistence would conflate "what changed" with "what got saved" and
  force every history consumer to think about IO. Rejected.
- *Expose only a free `debounceSave` util, no plugin wrapper.* Loses the
  familiar `createXxxPlugin` + `attachXxxPlugin` idiom and the
  observable state handle reviewers expect. Rejected.

### Decision 2: Separate the debounce policy from the autosave policy

The timing machinery lives in a **pure** `createDebouncedTask`
(`src/scheduler.ts`) that knows nothing about documents or editors. The
plugin (`src/index.ts`) owns the *policy*: baseline capture, dirty
tracking, document snapshots, and `onSave` wrapping.

**Why split:** the scheduler is the part most worth testing (race
conditions, flush/cancel semantics) and is easiest to test with fake
timers when it has no editor/DOM dependency. Splitting gives 10 pure
scheduler tests plus 11 integration tests, instead of 11 harder-to-reason
integration tests that each leak timing concerns.

**Alternatives considered:**

- *Use `lodash.debounce`.* Adds a dependency for a ~60-LOC primitive
  we already need customised (flush-returns-bool, running flag, injected
  timers). Hand-rolling keeps the dependency closure at zero and gives
  exactly the surface we need. Rejected the dependency.
- *Put `setTimeout` directly in the plugin.* Tests would need real-timer
  waits or global monkeypatching; the injected `scheduleFn` / `clearFn`
  in the scheduler makes fake-timer testing trivial. Rejected.

### Decision 3: Dirty tracking by document snapshot, baseline captured at attach

On `attachEditor`, `lastSavedDoc = editor.getDocument()` — the loaded
document is the clean baseline. A save skips when `doc === lastSavedDoc`;
`dirty` is `current !== lastSavedDoc`.

**Why snapshot equality rather than a `dirty` boolean flipped on every
change:**

- The baseline is captured from the *loaded* file, so opening a document
  never triggers a save (a naive `dirty = true` on first change would
  re-save the file you just opened — wasteful and surprising).
- Equality also makes `flush()` a clean no-op on a pristine document —
  exactly what a `beforeunload` / route-change guard wants.
- String equality is O(n) but only runs on save, not on every keystroke;
  it is negligible versus the IO it prevents.

**Alternatives considered:**

- *Track a `revision` counter from `change` events.* Core's `change`
  event does not currently carry a monotonically comparable revision we
  can diff against a saved baseline without extra bookkeeping; a snapshot
  is simpler and self-contained. Rejected the counter.

### Decision 4: Async-safe `onSave` with a `saving` flag

`performSave` sets `saving = true` around `await options.onSave(doc)` and
updates `lastSavedDoc` only on success. A rejection leaves `dirty = true`
so the next edit retries, and is swallowed in the fire-and-forget timer
path (but surfaced to `flush()`'s awaiter).

**Why a flag, not fire-and-forget everywhere:** without awaiting, two
rapid pauses could spawn two overlapping `onSave` calls; the second may
finish first and the first (stale) write could clobber it. Awaiting in
`performSave` serialises saves; the `saving` flag lets `getState()`
report progress to any host UI.

### Decision 5: Manual `attachEditor` + `attachAutosavePlugin`, mirroring wordcount

`createAutosavePlugin` returns `NexusPlugin & AutosaveAPI & {
attachEditor }`. The recommended call site is the free function:

```ts
const autosave = createAutosavePlugin({ onSave });
const editor = createEditor({ container, plugins: [autosave] });
attachAutosavePlugin(autosave, editor);
```

**Why not auto-attach in core:** the `NexusPlugin` contract has no `init`
hook and core does not bind plugins to instances (by design — keeps core
decoupled from plugin lifecycle). The wordcount plugin already established
this pattern; following it keeps the codebase consistent and the
reviewer's mental model intact.

### Decision 6: Throws on missing `onSave`, not a silent no-op

`createAutosavePlugin` throws `TypeError` when `options.onSave` is absent.

**Why fail loud:** an autosave plugin *without* a save sink is a no-op
disguised as safety — the most dangerous failure mode (the host believes
it is saving, but nothing persists). Throwing at construction surfaces the
misconfiguration immediately rather than silently dropping edits.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| String-equality dirty check is O(n) on every save. | Only runs at save time (debounced), never per keystroke; negligible versus the IO it prevents. For very large docs a future `contentHash` check is a one-line swap. |
| A rejected `onSave` leaves the doc dirty indefinitely if no further edits arrive. | `flush()` is awaitable and surfaces the rejection, so hosts can retry explicitly on, e.g., a reconnect. Documented in the README. |
| `destroy()` after a fire-and-forget timer already fired could run `onSave` on a detached editor. | `performSave` re-checks `destroyed` / `editor` at entry and reads `editor.getDocument()` (safe even post-detach because the doc snapshot is local). |
| `lastSavedDoc` is captured at attach but the host may have already persisted a *different* version before mounting. | Documented contract: the plugin trusts the currently-loaded document as the clean baseline. Hosts that load-then-save asynchronously should mount the plugin after the load completes. |
| Adding a package slows monorepo CI by one more build step. | The package is < 130 LOC source, builds in well under a second; `pnpm -r build` absorbs it without measurable wall-clock impact. |

## Migration Plan

No migration. New package; existing code unaffected. First release of
`@floatboat/nexus-plugin-autosave` follows the same `0.0.x` baseline as
the other workspace packages, published from the maintainers'
`pnpm publish:packages` workflow.

## Open Questions

- Should `flush()` reject (rather than silently return `false`) when
  called on a clean document, so callers can distinguish "saved nothing"
  from "saved successfully"? Current decision: return `false` for a
  uniform `boolean` contract; open to flipping if reviewers prefer a
  thrown/undefined distinction.
- Should a future v2 add an opt-in status-bar widget, or stay strictly
  headless and let hosts render `AutosaveState`? Current decision: stay
  headless; the observable state already covers the common UI need.
