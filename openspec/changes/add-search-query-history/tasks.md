## 1. OpenSpec and Test-First Setup

- [x] 1.1 Create OpenSpec change `add-search-query-history`.
- [x] 1.2 Define the first-stage `plugin-search` scope and `plugin-slash` non-goals.
- [x] 1.3 Add red tests for query history behavior before implementation.

## 2. Plugin Search Implementation

- [x] 2.1 Add a public, typed search history option to `createSearchPlugin()`.
- [x] 2.2 Add host-injected storage support without implicit global `localStorage` writes.
- [x] 2.3 Load stored history defensively, treating missing/invalid storage as empty history.
- [x] 2.4 Record submitted search queries after trimming and ignoring blank values.
- [x] 2.5 De-duplicate repeated queries by moving the newest entry to the front.
- [x] 2.6 Enforce `maxEntries` by dropping oldest entries.
- [x] 2.7 Wire ArrowUp / ArrowDown recall in the search input without stealing keys when no history is available.
- [x] 2.8 Preserve case-sensitive, regexp, whole-word, replace, and navigation behavior.

## 3. Verification

- [x] 3.1 Run the targeted `plugin-search` Vitest suite and confirm the new tests pass.
- [ ] 3.2 Run `pnpm test`.
- [x] 3.3 Run `pnpm build`.
- [ ] 3.4 Run `pnpm exec openspec validate add-search-query-history --strict` if the OpenSpec CLI is available.
