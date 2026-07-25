## 1. Implementation
- [ ] 1.1 Implement `buildFuzzyPattern()` — convert query string to RegExp
- [ ] 1.2 Implement `fuzzyScore()` — score a candidate against a query
- [ ] 1.3 Export both functions from plugin-search index
- [ ] 1.4 Integrate `fuzzy` option into `SearchOptions` and `SearchPluginOptions`
- [ ] 1.5 Add "Fuzzy" checkbox to `NexusSearchPanel` UI
- [ ] 1.6 Wire fuzzy checkbox into search commit / query lifecycle
- [ ] 1.7 Add vitest unit tests for fuzzy matching edge cases
- [ ] 1.8 Add vitest integration tests for search panel fuzzy toggle

## 2. Demo Integration
- [ ] 2.1 Show active search mode (fuzzy/regexp/plain) in status line

## 3. Verification
- [ ] 3.1 `pnpm test` all green
- [ ] 3.2 `pnpm --filter @floatboat/nexus-plugin-search build`
- [ ] 3.3 Manual test in electron-demo: Ctrl+F, toggle fuzzy, search
