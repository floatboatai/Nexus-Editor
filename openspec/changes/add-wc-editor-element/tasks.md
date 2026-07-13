# Implementation Tasks

## 1. Package scaffolding & workspace wiring

- [x] 1.1 Create `packages/wc/` with `package.json` matching the shape
  of `packages/react/package.json`: name `@floatboat/nexus-wc`, ESM
  `tsup` build, `@floatboat/nexus-core` workspace dep, public
  `publishConfig`.
- [x] 1.2 Create `packages/wc/tsconfig.json` extending
  `../../tsconfig.base.json`, including `src/**/*.ts` +
  `test/**/*.ts` (PR #49 finding: tsconfig did not extend the base).
- [x] 1.3 Add `"@floatboat/nexus-wc": ["packages/wc/src/index.ts"]` to
  `tsconfig.base.json` `paths` (PR #49 finding: alias missing).
- [x] 1.4 Add the matching alias to `vitest.config.ts` `resolve.alias`.
- [x] 1.5 Append `&& pnpm --filter @floatboat/nexus-wc build` to the
  root `build` script **after** the core build (PR #49 findings:
  filter/package name mismatch; build ordered before dependency).
- [x] 1.6 Run `pnpm install` so `pnpm-lock.yaml` registers the new
  workspace package (CI installs with `--frozen-lockfile`).

## 2. Controlled-document helpers (`src/controlled-document.ts`)

- [x] 2.1 Mirror the pure helpers from
  `packages/react/src/controlled-document.ts`
  (`isControlledDocument`, `resolveInitialDocument`,
  `shouldSyncControlledDocument`) so all three bindings share
  identical semantics.
- [x] 2.2 Unit-test them in `test/controlled-document.test.ts`,
  matching the React/Vue test coverage.

## 3. Attribute parsing (`src/attributes.ts`)

- [x] 3.1 Implement typed readers for boolean (presence), integer, and
  enumerated (`direction`) attributes; invalid numbers fall back to
  `undefined` (core default) rather than `NaN`.
- [x] 3.2 Implement `readAttributeConfig(el)` producing the
  `EditorConfig` subset the attribute surface covers.
- [x] 3.3 Unit-test the parsers in `test/attributes.test.ts`.

## 4. The element (`src/element.ts`)

- [x] 4.1 `connectedCallback` creates the editor (element as
  container), seeds it from property-else-attribute config, and emits
  `nexus-ready`.
- [x] 4.2 `disconnectedCallback` defers destroy to a microtask so
  same-task reparenting keeps the editor; real removal destroys it and
  captures the document for a later re-insertion.
- [x] 4.3 Controlled `value`: property accessor pair + attribute
  observation, silent `setDocument` sync guarded by the
  last-synced-document check, no `nexus-change` echo.
- [x] 4.4 Non-`value` observed attributes and rich property setters
  mark config dirty and schedule a microtask-coalesced rebuild that
  preserves document + selection and re-emits `nexus-ready` (PR #49
  finding: attribute changes after mount were silent no-ops).
- [x] 4.5 Re-dispatch core `change` / `focus` / `blur` events as
  composed, bubbling `nexus-*` `CustomEvent`s.
- [x] 4.6 `editor` read-only accessor exposing the live `EditorAPI`.

## 5. Public entry (`src/index.ts`)

- [x] 5.1 Export `NexusEditorElement`, `defineNexusEditor`, and event
  detail types; no import-time `customElements` access.

## 6. Tests (`test/element.test.ts`)

- [x] 6.1 Registration: no side effect on import, idempotent
  `defineNexusEditor`, foreign-constructor collision throws.
- [x] 6.2 Lifecycle: mount renders `.cm-editor`; removal destroys;
  reparenting preserves instance + document; re-insertion restores
  captured document.
- [x] 6.3 Config: attributes reach `createEditor`; plugins/property
  config applied; property beats attribute.
- [x] 6.4 Controlled document: silent external sync (no echo), user
  edits emit `nexus-change`, getter tracks edits.
- [x] 6.5 Rebuild: post-mount `readonly` takes effect with document +
  selection preserved; multiple same-task attribute writes coalesce
  into one rebuild; `nexus-ready` re-fires with the new instance.
- [x] 6.6 Events bubble to ancestors (delegation).

## 7. Docs & repo integration

- [x] 7.1 `packages/wc/README.md` — install, plain-HTML example,
  attribute/property/event tables, controlled usage, rebuild
  semantics, framework notes.
- [x] 7.2 Root `README.md` / `README.zh.md` — Web Component flavor in
  Quick Start.
- [x] 7.3 `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` — `wc` scope row.
- [x] 7.4 `docs/ROADMAP.md` / `docs/ROADMAP.zh.md` — row #22 →
  `in-progress` with this change id linked.

## 8. Verification

- [x] 8.1 `pnpm typecheck` green.
- [x] 8.2 `pnpm test` green (new suites included).
- [x] 8.3 `pnpm build` green (wc builds after core).
- [x] 8.4 Manual browser smoke test of the README plain-HTML example.
