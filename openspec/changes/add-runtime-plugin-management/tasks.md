# Tasks — add-runtime-plugin-management

## 1. Core: runtime plugin registry

- [x] 1.1 `packages/core/src/runtime-plugins.ts`: hook classifier (hot-pluggable vs construction-time) + registry (`Map<string, NexusPlugin>`) + extension derivation (shortcuts→keymap + cmExtensions, insertion order) + `Compartment` wiring
- [x] 1.2 `editor.ts`: seed the compartment in the static extension array; implement `addPlugin` / `removePlugin` / `getPlugins`; rollback-on-dispatch-failure; destroyed-editor guards
- [x] 1.3 `types.ts`: `EditorAPI` additions + `pluginsChange` event in `EditorEventMap`; `index.ts` exports
- [x] 1.4 Emit `pluginsChange` after successful add/remove

## 2. Core: tests (`packages/core/test/runtime-plugins.test.ts`)

- [x] 2.1 add → extension takes effect immediately (keymap fires / view plugin active)
- [x] 2.2 remove → effect gone, `true` returned; unknown name → `false`
- [x] 2.3 reject: each construction-time hook (`widgets`, `remarkPlugins`, `slashCommands`, `commands`, `handlers`) throws with hook named in message
- [x] 2.4 reject: duplicate name (vs static and vs runtime); removing a static plugin throws
- [x] 2.5 destroyed editor: add/remove throw
- [x] 2.6 `getPlugins()` reflects static + runtime origins; `pluginsChange` fires with full list
- [x] 2.7 rollback: plugin whose extension throws on reconfigure leaves registry + editor state unchanged
- [x] 2.8 regression: editor without runtime plugins behaves identically (undo history preserved across add/remove of an unrelated plugin)

## 3. Sample plugin: `@floatboat/nexus-plugin-typewriter`

- [x] 3.1 Package scaffold mirroring `plugin-vim` (package.json, tsconfig, tsup, exports)
- [x] 3.2 `createTypewriterPlugin()`: cursor-line vertical centering; hot-pluggable hooks only. **Implementation note**: the planned `update listener + scrollIntoView(head, {y:"center"})` effect was replaced during manual verification — CodeMirror overwrites a single pending scroll-target slot per transaction with a `y:"nearest"` request on every native input, which races (and, under sustained typing, permanently loses to or wins against) an effect-based center request. Final implementation uses `view.requestMeasure({ key, read, write })` to read cursor-vs-scroller offset and write `scrollDOM.scrollTop` directly, which converges regardless of native scroll ordering. See `design.md` D4 for the full investigation.
- [x] 3.3 Tests: plugin shape (name, only `cmExtensions`); measure-pass scheduling on doc change / cursor motion (not dispatch — see 3.2); geometry computation + unmeasurable/destroyed no-ops; install/uninstall round-trip
- [x] 3.4 `packages/plugin-typewriter/README.md`

## 4. Electron demo: plugin marketplace (policy layer)

- [x] 4.1 Marketplace-style panel UI: curated listings, search, featured/installed/local tabs, status badges, and polished placeholder entries for future plugins
- [x] 4.2 Wire toggle → dynamic `import()` + `addPlugin` / `removePlugin`; state from `getPlugins()` + `pluginsChange`
- [x] 4.3 Local-folder preview affordance: allow folder selection/display in the Electron shell without importing or executing arbitrary local code
- [x] 4.4 Preserve panel layout while hidden/shown: restore the original `display` value and keep the marketplace list vertically scrollable
- [x] 4.5 Verify manually: typewriter centering active only while installed (including sustained Enter-holding — the bug this design iterated through); uninstall restores normal scrolling; marketplace panel scrolls in the running Electron demo — confirmed by user

## 5. Docs & housekeeping

- [x] 5.1 `packages/core/README.md`: runtime plugin API section incl. hook classification table
- [x] 5.2 `docs/ROADMAP.md` + `docs/ROADMAP.zh.md`: new Plugin System row (#30, linked to this change, cross-ref #11)
- [x] 5.3 `openspec validate add-runtime-plugin-management --strict` passes
- [x] 5.4 Full gate: `pnpm test` (543/543 green), `pnpm typecheck` (clean), core + typewriter packages build successfully
