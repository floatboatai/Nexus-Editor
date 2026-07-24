# Tasks: add-wc-wrapper

## 1. Package scaffold
- [x] 1.1 Create `packages/wc/package.json` (name `@floatboat/nexus-wc`, workspace dep on `@floatboat/nexus-core`, tsup ESM build)
- [x] 1.2 Create `packages/wc/tsconfig.json` extending `tsconfig.base.json`
- [x] 1.3 Register `@floatboat/nexus-wc` in root `vitest.config.ts` alias map and root `package.json` build script

## 2. Element implementation
- [x] 2.1 `src/controlled-document.ts` — pure helpers (mirrors `packages/react/src/controlled-document.ts`)
- [x] 2.2 `src/types.ts` — attribute name constants, `NexusEditorEventDetail` map
- [x] 2.3 `src/element.ts` — `NexusEditorElement extends HTMLElement`: light-DOM container, `connectedCallback` / `disconnectedCallback` / `attributeChangedCallback`, attribute/property surface, custom event dispatch, `.editor` getter
- [x] 2.4 `src/index.ts` — export `NexusEditorElement`, `defineNexusEditor()`

## 3. Tests
- [x] 3.1 `test/controlled-document.test.ts` — unit tests for pure helpers
- [x] 3.2 `test/element.test.ts` — jsdom custom-element tests: mount/unmount, attribute→config mapping, controlled `value` sync, event dispatch, `.editor` readiness

## 4. Docs
- [x] 4.1 `packages/wc/README.md` — install, `<nexus-editor>` usage, attribute/property/event tables, parity note vs React/Vue
- [x] 4.2 Update `docs/ROADMAP.md` row #22: `status planned → in-progress`, fill OpenSpec link

## 5. Review hardening
- [x] 5.1 Preserve pre-upgrade properties and synchronous DOM reparenting
- [x] 5.2 Cancel stale delayed change notifications after silent external replacement
- [x] 5.3 Compose public events across shadow boundaries and expose DOM event/tag typings
- [x] 5.4 Forward the existing core `multiCursor` creation option
- [x] 5.5 Reject foreign custom-element tag collisions
- [x] 5.6 Add regression coverage for every review finding

## 6. Iframe bridge
- [x] 6.1 Add a versioned, origin-checked discovery and MessageChannel protocol
- [x] 6.2 Export the parent controller with ready/change, get/setDocument, focus, timeout, reload, and destroy behavior
- [x] 6.3 Export the iframe runtime that mounts core with local configuration and validates the parent origin
- [x] 6.4 Add parent/runtime regression tests, public types, package subpath exports, and usage documentation
- [x] 6.5 Extend the browser test bench and Chinese manual checklist for same-origin and cross-origin iframe scenarios
