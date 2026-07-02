# Change: Add Runtime Plugin Management (hot add / remove) to Core

## Why

Roadmap item **#11 — Plugin hot-reload (`core`, P3)** is blocked on #9 (Widget API standardization), but an audit shows a large, useful subset of it is achievable today without touching the blocked surface.

The plugin array is frozen at construction time. `createEditor` flattens every plugin hook into closure-captured collections (`packages/core/src/editor.ts:246-277` — `shortcuts`, `cmExtensions`, `widgets`, `commands`, `handlers.*` are all `flatMap`-ed once), and `...cmExtensions` is spread statically into `EditorState.create` (`editor.ts:707`). There is no API to add or remove a plugin on a live editor — the only way to change the plugin set is to destroy and recreate the editor, losing undo history, selection, scroll position, and IME state.

Yet the codebase already contains the exact mechanism needed: theme switching uses a CodeMirror 6 `Compartment` to hot-swap its extension at runtime (`packages/core/src/theme.ts:151`, dispatched at `editor.ts:731`). This is the only `Compartment` usage in the repo. Extending the same proven pattern from "one theme extension" to "the set of runtime-added plugin extensions" is a natural, low-risk generalization.

The critical constraint — and the reason this proposal does **not** claim to implement all of #11 — is that plugin hooks differ fundamentally in how deep they reach into the editor:

- `cmExtensions` and `shortcuts` map 1:1 onto CodeMirror extensions. CM6's `Compartment.reconfigure` adds **and removes** them atomically and completely — uninstall leaves zero residue.
- `widgets` and `remarkPlugins` are consumed by pipelines that are sealed at construction (`normalizeConfig` in live-preview runs once; `transformProcessor` / `fallbackParser` are built once at `editor.ts:271-277`). Safe teardown of live widgets is exactly the unsolved problem tracked as #9.
- `slashCommands`, `commands`, and `handlers` are captured in closures (`editor.ts:252-265, 619`) and would silently not take effect if "added" at runtime.

A runtime plugin API that pretended to accept any plugin would therefore ship silent breakage. Instead, this change introduces **capability-classified hot-plugging**: plugins whose hooks are all hot-pluggable are added/removed live; plugins that declare construction-time hooks are rejected with an explicit, actionable error. This mirrors how mature editor platforms bound the same risk — VS Code forbids extensions from touching editor internals entirely (process-isolated API surface); we instead exclude the deep-reaching hook classes from hot-plugging. Same principle: the deeper a plugin reaches, the less safely it can be dynamically unloaded.

To prove the mechanism end-to-end, the change also ships:

- a new sample plugin **`@floatboat/nexus-plugin-typewriter`** (typewriter scrolling — keeps the cursor line vertically centered), deliberately implemented with hot-pluggable hooks only, and
- an **electron-demo marketplace-style plugin panel** that installs/uninstalls it against a live editor, while showing polished placeholder listings for future extensions — demonstrating the mechanism/policy split: core provides the mechanism (runtime add/remove), the demo app owns the policy (what to install, when, and the UI). The panel also previews the intended "add from local folder" path without loading or executing arbitrary local code.

## What Changes

- **Core (`@floatboat/nexus-core`)**:
  - New module `packages/core/src/runtime-plugins.ts`: a `Compartment`-backed registry for plugins added after construction.
  - **API additions** (all additive, no breaking changes):
    - `addPlugin(plugin: NexusPlugin): void` — validates the plugin, then hot-installs it into the live editor. Throws when:
      - the plugin declares any construction-time hook (`widgets`, `remarkPlugins`, `slashCommands`, `commands`, `handlers`) — error names the offending hooks and points to the static `plugins` config;
      - a plugin with the same `name` is already present (static or runtime);
      - the editor is destroyed.
    - `removePlugin(name: string): boolean` — hot-uninstalls a **runtime-added** plugin (`true`), returns `false` for unknown names. Throws when `name` refers to a construction-time plugin: static plugins may hold non-removable hooks, so allowing removal would strand half a plugin. The error says to recreate the editor instead.
    - `getPlugins(): { name: string; runtime: boolean }[]` — lists all installed plugins and their origin.
  - **New event** `pluginsChange: (plugins: { name: string; runtime: boolean }[]) => void` on the existing emitter — lets hosts (e.g. the demo panel) reactively render install state.
  - Implementation detail: one `new Compartment()` seeded with `[]` is appended to the static extension list (`editor.ts:707` area). `addPlugin`/`removePlugin` re-derive the full runtime extension set (each plugin's `shortcuts` converted via the same path as static shortcuts, plus its `cmExtensions`) and dispatch a single `compartment.reconfigure(...)` — the same transaction shape as `setTheme`.
- **New package `@floatboat/nexus-plugin-typewriter`** (`packages/plugin-typewriter`):
  - `createTypewriterPlugin(): NexusPlugin` — `{ name: "plugin-typewriter", cmExtensions: [...] }`, no other hooks (hot-pluggable by construction).
  - Behavior: after user edits or cursor movement, scrolls the view so the cursor line sits at the vertical center of the scroller (classic typewriter mode, cf. iA Writer / Obsidian). Implemented with a `ViewPlugin` that schedules `view.requestMeasure({ key, read, write })` to read the cursor-vs-scroller offset and write `scrollDOM.scrollTop` directly — see `design.md` D4 for why the more obvious `scrollIntoView` effect approach doesn't work (it competes with CodeMirror's native `y:"nearest"` scroll request for a single pending scroll-target slot and can permanently lose under sustained typing). No DOM listeners, no timers held across destroy, nothing to leak on uninstall.
- **Electron demo (`apps/electron-demo`)**:
  - A marketplace-style "Extensions" / "Marketplace" panel with curated listings, search, featured/installed/local tabs, and status badges. Only the bundled Typewriter Mode listing is executable; its install/remove action is wired to `addPlugin` / `removePlugin`, state driven by `getPlugins()` + the `pluginsChange` event. The typewriter plugin is **not** in the demo's static plugin array — it is only ever installed at runtime, proving the mechanism.
  - A local-folder preview entry point that can select and display a folder in the Electron shell, but deliberately does **not** import or execute anything from that folder. This keeps the future local-plugin UX visible without implying a trust/sandboxing model that this change does not provide.
- **Docs**: `packages/core/README.md` section for the runtime plugin API (including the hot-pluggable vs construction-time hook table); `packages/plugin-typewriter/README.md`; `docs/ROADMAP.md` (+ zh): new row under "4. Plugin System" for runtime plugin management, linked to this change id and cross-referenced with #11 (this change delivers the non-widget subset of #11 and unblocks incremental progress on it).

React/Vue bindings need no code change: both expose the `EditorAPI` handle as-is, so `addPlugin` / `removePlugin` / `getPlugins` flow through automatically.

## Impact

- Affected specs:
  - `runtime-plugin-management` (ADDED — new capability: classification rules, add/remove semantics, error contracts, events)
  - `plugin-typewriter` (ADDED — new capability: typewriter scrolling behavior and hot-pluggability contract)
- Affected code:
  - `packages/core/src/runtime-plugins.ts` (NEW)
  - `packages/core/src/editor.ts` (seed compartment, wire API methods + event)
  - `packages/core/src/types.ts` (API + event types)
  - `packages/core/src/index.ts` (exports)
  - `packages/core/test/runtime-plugins.test.ts` (NEW)
  - `packages/plugin-typewriter/*` (NEW package: src, test, README, package.json, tsconfig, tsup config mirroring `plugin-vim`)
  - `apps/electron-demo/src/renderer/*` (plugin panel UI + wiring)
  - `packages/core/README.md`, `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`
- New dependencies: none (typewriter uses only `@codemirror/view` / `@codemirror/state`, already core peers).
- Out of scope (explicit non-goals):
  - Hot-plugging plugins with `widgets` / `remarkPlugins` — blocked on #9 (widget lifecycle contract); the classification layer is designed so these can graduate to hot-pluggable later without API changes.
  - Runtime add/remove of `slashCommands` / `commands` / `handlers` — requires migrating closure-captured collections to mutable state; deferred to keep this change reviewable, same graduation path.
  - Removing construction-time plugins — cannot be torn down completely today; explicitly rejected rather than partially honored.
  - Loading third-party plugin code from arbitrary filesystem paths or a marketplace — a trust/sandboxing model does not exist and is a product-layer (host app) concern, not an engine concern. The demo marketplace may show placeholder listings and a local-folder preview, but it installs only known, bundled-at-build-time modules via dynamic import; distribution/discovery/execution of untrusted plugins is deliberately unaddressed.
  - IME/composition interplay beyond what `Compartment.reconfigure` already guarantees (same guarantees as runtime theme switching).
