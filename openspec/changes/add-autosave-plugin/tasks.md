## 1. Implementation
- [ ] 1.1 Scaffold `packages/plugin-autosave` (package.json, src, test, README)
- [ ] 1.2 Implement `createAutoSavePlugin` (debounce + flush + destroy)
- [ ] 1.3 Write vitest cases (debounce, burst, no-op before delay, flush, destroy)
- [ ] 1.4 Document usage in package README

## 2. Verification
- [ ] 2.1 `pnpm test` passes for the new package
- [ ] 2.2 `pnpm build` succeeds for the new package
- [ ] 2.3 Manual note: behavior matches docs/ROADMAP pain point (onChange debounce)
