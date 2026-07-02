# Change: Add `@floatboat/nexus-wc` — `<nexus-editor>` Web Component wrapper

## Why

ROADMAP #22 ("Web Component / iframe wrapper", P2) exists because the
current SDK story stops at React and Vue. Hosts outside those two
ecosystems — Svelte / SolidJS apps, server-rendered Rails or Django
templates, legacy jQuery surfaces, CMS plugin sandboxes — today have to
hand-roll the same ~80 lines of `createEditor` lifecycle glue that
`packages/react/src/use-editor.ts` and `packages/vue/src/use-editor.ts`
already encode, and they usually get the hard parts wrong:

- **Controlled-document feedback loops.** Wiring `value` in and
  `change` out without a silent-sync guard echoes every keystroke back
  into `setDocument`, which resets the viewport and breaks IME
  composition (see `SetDocumentOptions.silent` in
  `packages/core/src/types.ts`).
- **Lifecycle leaks.** Forgetting `editor.destroy()` on teardown leaks
  CodeMirror view listeners; destroying eagerly on every DOM move
  loses the document.
- **Config plumbing drift.** Each hand-rolled wrapper picks a different
  subset of `EditorConfig` to expose, so knowledge doesn't transfer
  between hosts.

A custom element is the standards-track answer: one `<nexus-editor>`
tag that works in plain HTML and in every framework that can render
DOM, with the same controlled-document semantics the React and Vue
bindings already ship.

An earlier community attempt (PR #49) was closed with concrete review
findings: no OpenSpec proposal, four workspace-wiring bugs (package
name mismatch in root build filters, `tsconfig` not extending the
base, missing `tsconfig.base.json` path alias, build ordered before
its dependency), attribute changes after mount silently doing nothing,
and a 3,175-line demo app dwarfing the wrapper. This change re-lands
the capability with those findings addressed and the demo explicitly
out of scope.

## What Changes

- **New package `@floatboat/nexus-wc`** under `packages/wc/`. Public
  surface:
  - `NexusEditorElement` — the custom element class. Mounts a core
    editor into itself (light DOM) on `connectedCallback`, destroys it
    when the element actually leaves the document, and preserves the
    document across same-task DOM moves and detach/reattach cycles.
  - `defineNexusEditor(tagName = "nexus-editor")` — idempotent
    registration helper. Importing the package has no side effects
    (SSR-safe); registration is an explicit call.
  - Event detail types: `NexusChangeDetail`, `NexusReadyDetail`.
- **Attributes** (declarative, all observed): `value`, `readonly`,
  `direction`, `tab-size`, `indent-guides`, `parse-delay-ms`,
  `slash-menu-limit`, `live-preview`, `multi-cursor`. Boolean
  attributes follow the HTML convention — presence means `true`,
  absence defers to the core default.
- **Properties** (imperative, for non-string config): `plugins`,
  `parser`, `theme`, `locale`, `livePreview` (object form),
  `onAssetUpload`, plus a `value` accessor pair and a read-only
  `editor` escape hatch returning the live `EditorAPI`.
- **Attribute changes after mount take effect** — the finding that
  closed PR #49. `value` syncs through the same silent-`setDocument`
  controlled-document helpers the React and Vue bindings use; every
  other observed attribute schedules a microtask-coalesced editor
  rebuild that preserves the current document and selection, then
  re-emits `nexus-ready` with the new `EditorAPI` instance.
- **Events**: `nexus-ready`, `nexus-change`, `nexus-focus`,
  `nexus-blur` — `CustomEvent`s that bubble and are `composed`, so
  hosts can delegate at any ancestor.
- **Workspace integration** — `tsconfig.base.json` path alias,
  `vitest.config.ts` resolve alias, root `package.json` `build` script
  entry ordered **after** `@floatboat/nexus-core`, scope whitelist row
  in `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` (`wc`), ROADMAP #22 row
  update, Web Component section in `README.md` / `README.zh.md`.

No breaking changes. No core changes — the element consumes only the
existing public `createEditor` / `EditorAPI` surface, exactly like the
React and Vue bindings.

## Impact

- Affected specs:
  - `wc-editor-element` (NEW capability) — element lifecycle,
    attribute/property config contract, controlled document semantics,
    event surface.
- Affected code:
  - `packages/wc/` (NEW package — `src/index.ts`, `src/element.ts`,
    `src/attributes.ts`, `src/controlled-document.ts`, `README.md`,
    `package.json`, `tsconfig.json`, `test/element.test.ts`,
    `test/attributes.test.ts`, `test/controlled-document.test.ts`).
  - `tsconfig.base.json` (path alias).
  - `vitest.config.ts` (resolve alias).
  - `package.json` (root `build` script — after core).
  - `pnpm-lock.yaml` (workspace package registration).
  - `pnpm-workspace.yaml` left untouched — already globs `packages/*`.
  - `CONTRIBUTING.md` / `CONTRIBUTING.zh.md` (scope whitelist row).
  - `docs/ROADMAP.md` / `docs/ROADMAP.zh.md` (row #22 status + link).
  - `README.md` / `README.zh.md` (Web Component quick-start flavor).
- New external dependencies: **none**. The package depends only on
  `@floatboat/nexus-core` (workspace) and the DOM standard library.
- Out of scope (explicit non-goals):
  - **Shadow DOM.** CodeMirror's style-mod can adopt into shadow
    roots, but the live-preview overlays, slash-menu coordinate math,
    and table-widget interactions have never been audited against a
    shadow boundary. Light DOM matches what the React/Vue bindings
    render today; an opt-in `shadow` attribute is a follow-up change.
  - **iframe wrapper.** The other half of ROADMAP #22 — different
    isolation model, different messaging surface, separate proposal.
  - **Form association** (`ElementInternals`, `formAssociated`).
    Useful for `<form>` submission of markdown, but jsdom support is
    incomplete and it drags in validation semantics; follow-up.
  - **A demo app.** Per the PR #49 review, a demo belongs in its own
    PR. The package README carries a copy-paste plain-HTML example.
  - **Runtime reactivity for rich properties** (`plugins`, `parser`,
    `theme`, `locale`). Setting them after mount triggers the same
    documented rebuild as attributes; fine-grained hot swapping
    (e.g. `setTheme`) is deliberately not wired in v1 to keep the
    rebuild semantics uniform.
