## 1. OpenSpec

- [x] 1.1 Create OpenSpec change `add-fuzzy-search`.
- [x] 1.2 Define plugin-search fuzzy helper scope and CodeMirror panel non-goals.

## 2. Plugin Search Implementation

- [x] 2.1 Add typed fuzzy search options and fuzzy match metadata.
- [x] 2.2 Implement dependency-free subsequence matching with ranking.
- [x] 2.3 Preserve default exact, regex, whole-word, and replacement behavior.
- [x] 2.4 Add `maxMatches` and score/document ordering support.
- [x] 2.5 Add fuzzy replacement for helper-based replacement flows.

## 3. Demo and Docs

- [x] 3.1 Add a fuzzy toggle to the Electron demo search bar.
- [x] 3.2 Document plugin-search fuzzy options and metadata.
- [x] 3.3 Update roadmap status for Roadmap #17.

## 4. Verification

- [x] 4.1 Add Vitest coverage for fuzzy matching, ranking, case sensitivity, limits, boundaries, and replacement.
- [x] 4.2 Run targeted plugin-search Vitest suite.
- [x] 4.3 Run plugin-search TypeScript check.
- [x] 4.4 Run plugin-search build.
- [ ] 4.5 Run `openspec validate add-fuzzy-search --strict` — CLI is not installed in this dev environment; spec format was hand-checked against `openspec/AGENTS.md`.
- [ ] 4.6 Run full repo `pnpm test` after full dependency install is available; direct full Vitest run is blocked locally by missing workspace dependencies after `pnpm install` timed out on `app-builder-bin`.
