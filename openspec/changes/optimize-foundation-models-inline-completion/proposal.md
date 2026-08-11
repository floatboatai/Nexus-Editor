## Why

The macOS Foundation Models inline completion feature is functionally complete, but several hot paths still do unnecessary work during typing: the renderer materializes and scans the full document, stale model requests can keep running after the UI no longer needs them, and every eligible pause sends an uncached prompt to the native model.

This change improves the feature's completion quality as a PR submission by making latency, cancellation, and request efficiency explicit parts of the implementation rather than incidental behavior.

## What Changes

- Optimize renderer context extraction so eligibility checks inspect only the cursor's local paragraph and nearby fence state instead of converting and scanning the whole document on every editor update.
- Add an explicit cancellation path from renderer to Electron main/native Swift so blur, Escape, disable, dispose, and superseded requests stop current generation instead of only discarding late results.
- Reduce prompt and token overhead by moving stable instructions into the session contract, bounding paragraph context length, and keeping model output constrained to a short inline sentence.
- Add a short-lived in-memory cache for repeated paragraph suggestions and null results, with prompt/model versioning in the cache key and privacy-preserving process-local storage only.
- Add dev/test instrumentation points for request lifecycle timing and cache/cancellation behavior without exposing document text.
- No breaking changes to the renderer-facing feature behavior: Tab still accepts only a visible suggestion, unsupported platforms still no-op safely, and document text remains on-device.

## Capabilities

### New Capabilities

- `foundation-models-inline-completion`: Covers the macOS-only Foundation Models inline completion behavior, with performance-oriented requirements for local context extraction, native request lifecycle, prompt budget, caching, and observability.

### Modified Capabilities

- None. The repository currently has no archived OpenSpec capability for this feature; this change introduces the capability contract for the optimized feature branch.

## Impact

- Affected code:
  - `apps/electron-demo/src/renderer/foundation-models-context.ts`
  - `apps/electron-demo/src/renderer/foundation-models-plugin.ts`
  - `apps/electron-demo/src/renderer/foundation-models.ts`
  - `apps/electron-demo/electron/foundation-models.ts`
  - `apps/electron-demo/electron/main.ts`
  - `apps/electron-demo/electron/preload.ts`
  - `apps/electron-demo/src/renderer/bridge.d.ts`
  - `apps/electron-demo/native/foundation-models/Sources/FoundationModelsCore/FoundationModelsService.swift`
  - `apps/electron-demo/native/foundation-models/Sources/NodeAddon/Addon.swift`
  - Existing Foundation Models tests and smoke tests.
- APIs:
  - Extends the internal Foundation Models bridge with cancellation and optional development metrics.
  - Does not change public package APIs in `packages/core`.
- Dependencies:
  - No new runtime dependencies.
- Systems:
  - macOS native addon request lifecycle.
  - Electron IPC/preload bridge.
  - CodeMirror renderer plugin update path.
