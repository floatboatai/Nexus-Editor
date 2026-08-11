## 1. Test Coverage Baseline

- [x] 1.1 Add renderer context tests proving large documents are handled without requiring a full-document string scan and still reject ineligible Markdown regions.
- [x] 1.2 Add renderer plugin tests for active request cancellation on document change, cursor movement, Escape, blur, setting disable, and dispose.
- [x] 1.3 Add bridge tests for `cancelSuggestion()` fallback behavior when the native addon is unavailable.
- [x] 1.4 Add Swift core tests for bounded paragraph input, prompt construction, cancellation entry point, and output normalization budget.
- [x] 1.5 Add cache tests covering suggestion hits, null-result hits, TTL expiry, and prompt/model version key separation.

## 2. Renderer Hot Path Optimization

- [x] 2.1 Refactor suggestion context extraction to use CodeMirror document line APIs and cursor-local paragraph scanning instead of per-update full document materialization.
- [x] 2.2 Add bounded backward fenced-code detection that fails closed when the scan budget cannot determine a safe prose context.
- [x] 2.3 Replace stale-result validation that depends on full-document string equality with request id, cursor position, and local context identity checks.
- [x] 2.4 Verify existing suggestion eligibility behavior remains unchanged for normal prose, headings, lists, block quotes, code blocks, tables, and unfinished inline Markdown syntax.

## 3. Cancellation Lifecycle

- [x] 3.1 Extend the renderer-facing Foundation Models bridge type with `cancelSuggestion(): Promise<void> | void`.
- [x] 3.2 Wire renderer clear paths to call cancellation when a suggestion request may be active.
- [x] 3.3 Add Electron main/preload handling for cancellation with safe no-op behavior on unsupported platforms or missing native addon.
- [x] 3.4 Add a native Swift N-API `cancelSuggestion` export that forwards to the shared Foundation Models service.
- [x] 3.5 Implement a service-level cancellation method that cancels the current generation task and clears active task state.

## 4. Prompt Budget and Cache

- [x] 4.1 Move stable completion instructions into the native session contract and reduce per-request prompt text to the bounded paragraph context plus minimal task cue.
- [x] 4.2 Enforce a native input context budget even if callers send an overlong paragraph.
- [x] 4.3 Keep output normalization constrained to one short plain-text inline suggestion or `null`.
- [x] 4.4 Implement a small process-local in-memory cache keyed by normalized bounded paragraph, prompt version, model/profile version, and availability state.
- [x] 4.5 Cache both suggestion strings and null results with separate short TTLs and no disk persistence.

## 5. Observability and Verification

- [x] 5.1 Add opt-in development counters/durations for context extraction, scheduling, cache hits, native starts/completions, cancellations, stale results, and rendered suggestions.
- [x] 5.2 Ensure diagnostics never include raw paragraph text or generated suggestion text.
- [x] 5.3 Run focused Vitest suites for Foundation Models context, plugin, bridge, settings, and app handlers.
- [x] 5.4 Run Swift tests for the native Foundation Models package.
- [x] 5.5 Run the Electron demo typecheck/build path used by the existing feature branch.
- [x] 5.6 Update README or feature documentation with the performance behavior and manual verification notes if the public developer workflow changes.
