# Change: Add Fuzzy Search to `@floatboat/nexus-plugin-search`

## Why

Search in text editors often suffers from strict substring matching requirements. Users typing search queries in Markdown notes or documents frequently misspell words, abbreviate, or omit spaces (e.g. typing `fltbt` for `floatboat` or `liveprev` for `livePreview`).

Roadmap item #17 in `docs/ROADMAP.md` identifies Fuzzy Search for `@floatboat/nexus-plugin-search` as a planned capability. Adding fuzzy matching with score ranking, contiguous match bonuses, and precise sub-range highlighting enhances search usability without requiring third-party dependencies or altering existing search APIs.

## What Changes

- **New module `packages/plugin-search/src/fuzzy.ts`**:
  - `fuzzyMatch(pattern, text, options)`: Pure fzf-style subsequence search algorithm returning match score, contiguous substring bonus, word boundary bonus, and matching index ranges `[from, to][]`.
  - `createFuzzySearchCursor(doc, pattern, options)`: Iterates document lines or chunks and yields matches with character ranges.
- **Enhance `@floatboat/nexus-plugin-search` (`packages/plugin-search/src/index.ts`)**:
  - Add `fuzzy?: boolean` option to `SearchOptions` and `SearchPluginOptions`.
  - Update `NexusSearchPanel` UI to include a "Fuzzy" (`~`) checkbox toggle with `Alt+F` accesskey and test ID `search-fuzzy`.
  - Support fuzzy match scanning in GFM live-preview tables (`findRenderedTableSearchMatches`).
  - Export `fuzzyMatch`, `createFuzzySearchCursor`, and updated option types.
- **Tests & Documentation**:
  - Add comprehensive unit tests in `packages/plugin-search/test/fuzzy.test.ts`.
  - Update UI and integration tests in `packages/plugin-search/test/plugin-search.test.ts`.
  - Update `docs/ROADMAP.md` and `docs/ROADMAP.zh.md` marking item 17 as done.
  - Update `README.md` and `README.zh.md`.

No breaking changes. Standard substring matching remains the default when `fuzzy` is false.

## Impact

- Affected specs: `search` (MODIFIED requirement: Search Options & Matching).
- Affected code: `packages/plugin-search/src/fuzzy.ts`, `packages/plugin-search/src/index.ts`, `packages/plugin-search/test/fuzzy.test.ts`, `packages/plugin-search/test/plugin-search.test.ts`, `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`, `README.md`, `README.zh.md`.
