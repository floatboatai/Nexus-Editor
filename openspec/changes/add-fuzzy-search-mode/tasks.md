# Implementation Tasks

## 1. Plugin Search

- [x] 1.1 Add `FuzzySearchMatch`, `findFuzzySearchMatches`, and `createFuzzySearchPattern` exports.
- [x] 1.2 Extend `SearchOptions` with per-call `fuzzy?: boolean`.
- [x] 1.3 Extend `SearchPluginOptions` with plugin-level default `fuzzy?: boolean`.
- [x] 1.4 Add a `Fuzzy` checkbox to the search panel and wire it to CodeMirror search state.
- [x] 1.5 Disable incompatible regexp / whole-word toggles while fuzzy mode is active.
- [x] 1.6 Preserve the raw user input in the search field while fuzzy mode compiles a regexp query internally.

## 2. Tests

- [x] 2.1 Cover ordered fuzzy matching with indices and score metadata.
- [x] 2.2 Cover case-sensitive fuzzy matching.
- [x] 2.3 Cover `findSearchMatches(..., { fuzzy: true })`.
- [x] 2.4 Cover fuzzy regexp pattern generation and escaping.
- [x] 2.5 Cover search panel fuzzy mode defaults, disabled controls, raw input preservation, and navigation.

## 3. Documentation and Demo

- [x] 3.1 Add `packages/plugin-search/README.md` with fuzzy usage and API notes.
- [x] 3.2 Add `apps/electron-demo/sample-vault/fuzzy-demo.md`.
- [x] 3.3 Link the demo note from `apps/electron-demo/sample-vault/index.md`.
- [x] 3.4 Mark Roadmap item #17 as done and link this OpenSpec change in `docs/ROADMAP.md`.
- [x] 3.5 Mirror the Roadmap item #17 status/link update in `docs/ROADMAP.zh.md`.

## 4. Verify

- [x] 4.1 `corepack pnpm vitest run packages/plugin-search/test/plugin-search.test.ts`
- [x] 4.2 `corepack pnpm --filter @floatboat/nexus-plugin-search build`
- [x] 4.3 `corepack pnpm -r exec tsc --noEmit`
- [ ] 4.4 `openspec validate add-fuzzy-search-mode --strict` - CLI is not installed in this dev environment; spec format hand-linted against `openspec/AGENTS.md`.
