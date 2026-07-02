# Design — Runtime Plugin Management

## Context

`createEditor` consumes the plugin array exactly once. Every hook is flattened into closure state during construction (`editor.ts:246-277`) and the resulting extensions are spread statically into `EditorState.create` (`editor.ts:707`). The only runtime-reconfigurable slot in the whole codebase is the theme (`Compartment` in `theme.ts:151`).

Roadmap #11 (plugin hot-reload) is parked at P3 with an explicit dependency on #9 (widget API standardization), because tearing down live widgets safely is unsolved. This design carves out the subset of #11 that does **not** depend on #9 and ships it behind an honest capability boundary.

Stakeholders: library consumers (React/Vue/vanilla hosts wanting feature toggles without editor recreation), the electron demo (reference host), future #11 work (this must not paint it into a corner).

## Goals / Non-Goals

- Goals
  - Add/remove a plugin on a live editor without recreating it (preserving undo history, selection, scroll, IME state).
  - Deterministic, complete uninstall: after `removePlugin`, zero residue of the plugin remains (no keymaps, no view plugins, no listeners).
  - Fail loudly and helpfully on anything that cannot be honored at runtime today.
  - Keep a graduation path: hook classes can move from "construction-time" to "hot-pluggable" later without breaking the API.
- Non-Goals
  - Hot-plugging `widgets` / `remarkPlugins` (blocked on #9), `slashCommands` / `commands` / `handlers` (closure migration, separate change).
  - Removing construction-time plugins.
  - Sandboxing / trust model for third-party code; marketplace distribution. Engine provides mechanism; hosts own policy.

## Decisions

### D1 — Compartment-backed registry, single reconfigure per mutation

One `Compartment` seeded with `[]` joins the static extension array at construction. The registry maps `name → NexusPlugin` for runtime plugins. Every `addPlugin`/`removePlugin` re-derives the complete runtime extension list (deterministic order: insertion order; per plugin: shortcuts-keymap first, then `cmExtensions`) and dispatches one `compartment.reconfigure(list)`.

- Why: this is the exact pattern `setTheme` already ships (`editor.ts:731`), proven against CM6's transaction/IME machinery. Rebuilding the whole list per mutation (vs. incremental splicing) keeps state derivable from the registry alone — no drift between "what we think is installed" and "what CM has".
- Alternatives considered:
  - One `Compartment` per plugin: supports per-plugin reconfigure, but CM6 compartments cannot be *removed* from a state — an uninstalled plugin would leave an empty compartment behind forever. A growing zombie-compartment list contradicts "zero residue". Rejected.
  - `StateEffect.appendConfig`: append-only, no removal. Rejected.
  - Editor recreation under the hood: loses undo/selection/scroll/IME; that is precisely the problem this change exists to avoid. Rejected.

### D2 — Capability classification: validate hooks, reject construction-time ones

`addPlugin` inspects the plugin object. Hooks are classified:

| Hook | Class | Reason |
|---|---|---|
| `cmExtensions` | hot-pluggable | 1:1 CM extension; Compartment handles add+remove atomically |
| `shortcuts` | hot-pluggable | compiles to a keymap extension, same property |
| `widgets` | construction-time | live-preview pipeline sealed at construction; teardown = #9 |
| `remarkPlugins` | construction-time | parser/transform processors built once (`editor.ts:271-277`) |
| `slashCommands` | construction-time | captured by update-listener closure (`editor.ts:619`) |
| `commands` | construction-time | frozen `commandById` map (`editor.ts:252-255`) |
| `handlers` | construction-time | handler arrays captured by DOM-event closures (`editor.ts:257-265`) |

Declaring any construction-time hook ⇒ `addPlugin` throws, naming the offending hooks and pointing to the static `plugins` option.

- Why reject instead of partially honor: silently ignoring `widgets` while installing `cmExtensions` ships a half-working plugin — the worst failure mode (looks installed, misbehaves subtly). An explicit error at the call site is debuggable; a half-installed plugin is a support ticket.
- Why a table-driven classifier: when #9 lands, `widgets` graduates by editing one classification entry — no API change, no new method. The public contract ("unsupported hooks throw with a named reason") stays stable while coverage grows.
- Parallel: VS Code bounds the same risk by never letting extensions touch editor internals (isolated API surface). Same principle, different cut: the deeper a hook reaches into construction-time state, the less safely it can be dynamically unloaded — so those hooks are excluded until their lifecycle problem (#9) is solved.

### D3 — Asymmetry: runtime plugins removable, static plugins not

`removePlugin` only removes runtime-added plugins. Static plugins throw (with guidance to recreate the editor); unknown names return `false`.

- Why: static plugins may legitimately hold construction-time hooks; "removing" one could only strip its hot-pluggable half, stranding widgets/parsers with no owner. Runtime plugins are guaranteed 100% hot-pluggable by D2's gate, so their removal is provably complete. The asymmetry is the honest surface of that difference.
- Alternative — migrate static `cmExtensions` into the compartment so everything is removable: rejected; it changes transaction/dispatch behavior of every existing editor for a capability nobody asked for, and still can't remove construction-time hooks.

### D4 — Typewriter sample: deliberately minimal, hot-pluggable by construction

`createTypewriterPlugin()` returns `{ name, cmExtensions }` only. Getting the scrolling logic right took three iterations during manual verification in the live demo — recorded because each failure is a genuine CodeMirror pitfall, not typewriter-specific:

1. **`transactionExtender` appending a `scrollIntoView(head, { y: "center" })` effect** to the same transaction that inserts the line. Failed: the scroll target is computed against the pre-insert height map during fast sequential edits.
2. **Synchronous `view.dispatch()` from `ViewPlugin.update()`**. Failed: CM forbids re-entrant dispatch during an in-progress update — it throws, CM swallows the error ("plugin crashed"), and the scroll silently never happens. Tests asserting only "dispatch was called" (not "completed") pass anyway.
3. **`queueMicrotask`-deferred dispatch of the center effect**. Fixed both issues above and *still* failed in the live demo, which exposed the structural root cause: **CM keeps a single pending scroll-target slot, and every native input transaction overwrites it with a `y:"nearest"` request** (verified in `@codemirror/view` source: `EditorView.update` overwrites `scrollTarget` per transaction; `docView.scrollIntoView` silently drops targets whose coords aren't measurable). "nearest" no-ops while the cursor is visible but bottom-aligns once it leaves the viewport — which creates two self-sustaining regimes: **bottom-locked** (cursor at the bottom edge → "nearest" performs real scrolls every keystroke and out-competes the center request under load) and **center-locked** (one successful center → cursor mid-screen → "nearest" never fires again → centering wins forever). Observed exactly as predicted: holding Enter stayed bottom-locked until a single Arrow-key press flipped the editor into the center-locked regime for good.

**Final design: don't compete for the scroll-target slot at all.** `ViewPlugin.update()` schedules `view.requestMeasure({ key: this, read, write })`: `read` measures the cursor's offset from the scroller's vertical center, `write` applies the correction directly to `scrollDOM.scrollTop`. This **converges regardless of ordering** — if a "nearest" scroll lands first, the measure pass re-centers right after; once centered, "nearest" is a permanent no-op. `key: this` coalesces keystroke bursts into one measure per frame. A `destroyed` flag (set in the plugin's `destroy()`) makes a measure pass that resolves after teardown a no-op, so hot-uninstall stays residue-free.

- Why typewriter (vs. richer samples): visually undeniable install/uninstall proof; exercises a real `ViewPlugin`-class extension (not a toy keybinding) yet stays within the hot-pluggable class; zero new dependencies. In hindsight it also stress-tested the runtime-plugin mechanism far better than a trivial keybinding sample would have — precisely because correct scrolling is non-trivial.

### D5 — Demo marketplace = policy layer, dynamic import, not statically installed

The demo presents runtime plugin management as a marketplace-style side panel rather than a bare debug list. The catalog is host-owned and curated: it may show polished placeholder listings, status badges, search, installed/local tabs, and future-extension affordances, but only bundled entries with an explicit `load()` function can execute. Today, the Typewriter Mode listing performs a dynamic `import()` of the workspace-bundled module and calls `addPlugin`; uninstall calls `removePlugin`. The plugin never appears in the demo's static plugin array.

- Why: demonstrates the mechanism/policy split end-to-end — core knows nothing about panels or modules; the host decides what/when/how to install. Dynamic import keeps the plugin out of the initial closure, making "it was truly added at runtime" verifiable.
- Why a marketplace-shaped UI if there is no real marketplace yet: the demo is also the product reference surface. Showing realistic placeholders communicates the intended direction without expanding the core contract or claiming unsupported distribution semantics.
- Loading from arbitrary user-picked files was rejected: it would demo an untrusted-code path with no sandbox story, inviting exactly the misuse the non-goals exclude. The "Add local..." affordance is therefore a preview only: the Electron shell can select and display a folder path, but the renderer does not import, evaluate, or retain executable code from it. A real local-plugin flow would need a manifest, trust prompt, sandbox/loading policy, and lifecycle guarantees in a separate change.
- Implementation note: panels are hidden by toggling `display: none`. Because the marketplace panel owns a flex column with an internal scrolling list, the app remembers and restores each panel's original display value (e.g. `flex`) and keeps the main flex area/list at `min-height: 0`; otherwise toggling the panel would collapse its internal scroll container.

## Risks / Trade-offs

- **Risk**: a runtime plugin's `cmExtensions` could itself misbehave (throw in an update cycle) and take the editor down — same risk as static plugins, but now reachable post-construction. → Mitigation: `addPlugin` wraps the reconfigure dispatch; on throw, the registry rolls back and rethrows, leaving the editor in its prior state.
- **Risk**: duplicate keybindings between runtime and static plugins (CM keymap precedence surprises). → Mitigation: documented (runtime plugins sit after static extensions in precedence); not otherwise arbitrated — same as static plugin ordering today.
- **Trade-off**: rejecting five hook classes limits immediate usefulness. Accepted: the API contract is designed for graduation, and the alternative (silent partial installs) is strictly worse.
- **Risk**: `pluginsChange` adds a new event to the public map. → Additive only; no existing listener contracts change.
- **Risk**: marketplace-shaped placeholder UI could imply that arbitrary marketplace/local plugin loading is supported. → Mitigation: non-executable listings are disabled/preview-only, the local-folder flow explicitly says loading is disabled, and this design keeps arbitrary local/third-party code execution out of scope.

## Migration Plan

Purely additive — no existing API changes, no data migration. Rollback = revert the change; static-plugin editors are byte-identical in behavior (the empty compartment contributes no extensions).

## Open Questions

- Should `getPlugins()` also expose which hooks each plugin declares (useful for host UIs)? Deferred — trivially additive later.
- Event granularity: single `pluginsChange` vs. `pluginAdded`/`pluginRemoved` pair. Chosen: single event with full state (matches how the demo consumes it; finer events derivable).
