## Context

See `proposal.md` for motivation. The current feature branch already implements the macOS-only Foundation Models inline suggestion flow across the renderer plugin, Electron bridge, and Swift Node-API addon.

The current implementation has three important constraints:

- The feature must remain scoped to `apps/electron-demo`; reusable editor packages stay platform-neutral.
- Unsupported platforms and unavailable Foundation Models states must keep returning safe no-op behavior.
- Document text must stay on-device and must not be persisted by performance optimizations.

The optimization work targets request efficiency and editor responsiveness, not new user-facing UI.

## Goals / Non-Goals

**Goals:**

- Remove full-document string materialization from the renderer update path.
- Ensure stale or unwanted model generations are explicitly cancelled, not only ignored after completion.
- Reduce model input/output work through bounded context and stable prompt structure.
- Avoid repeated native requests for identical short-lived contexts.
- Add enough diagnostics to verify latency and request efficiency during manual review.

**Non-Goals:**

- Do not add a second visible completion mode, multi-suggestion UI, or streaming ghost text UI.
- Do not persist cache entries to disk.
- Do not add cloud fallback or any external model provider.
- Do not change `packages/core` public APIs.
- Do not require real Foundation Models access in cross-platform CI.

## Decisions

### Decision 1: Optimize context extraction around the cursor

Use CodeMirror document APIs and cursor position to inspect only the current paragraph neighborhood. The renderer should avoid `state.doc.toString()` during routine updates. Eligibility should be derived from:

- current line at cursor;
- adjacent lines until a blank paragraph boundary or configured scan budget;
- local Markdown structure checks for headings, lists, tables, block quotes, unfinished inline syntax, and fenced code state.

For fenced code detection, the implementation should avoid full-document scanning on every update. A practical approach is to scan backward only up to a bounded line budget and treat uncertainty as ineligible. This preserves responsiveness and fails safely by not requesting a suggestion.

Alternative considered: keep the existing full-document scan and rely on debounce. Rejected because the scan happens before debounce and can still affect typing and cursor movement in large files.

### Decision 2: Add explicit cancellation across renderer, bridge, and native service

Extend the internal bridge with `cancelSuggestion()` while preserving existing `getAvailability()` and `suggest(input)` behavior. Renderer clear paths call cancellation when a request may be active:

- new document or selection update;
- Escape;
- blur;
- setting disabled;
- availability changes to unavailable;
- plugin dispose.

The Swift service already has actor state and a generation task seam; cancellation should become an explicit public operation on the native module. Starting a new suggestion should also cancel any previous active task.

Alternative considered: rely only on request ids and stale-result checks. Rejected because that protects correctness but wastes native model work during rapid typing.

### Decision 3: Keep cache short-lived and process-local

Add a small in-memory cache at the Electron bridge or renderer controller boundary. The preferred location is the renderer/controller layer because it has direct knowledge of normalized paragraph context, enabled state, availability state, and request scheduling. The cache value may be a suggestion string or `null`.

Cache key inputs:

- normalized bounded paragraph context;
- prompt version constant;
- model/profile version constant;
- relevant availability state.

Recommended defaults:

- small maximum size, for example 64 entries;
- successful suggestion TTL around 60 seconds;
- null-result TTL around 15 seconds.

Persistent cache is intentionally excluded because editor text can be sensitive and the suggestion value is only useful for a short interaction window.

Alternative considered: persistent disk cache keyed by hash. Rejected because it adds privacy explanation burden and limited UX value for inline suggestions.

### Decision 4: Bound prompt context and move stable instructions out of each request

Keep the native session instruction as the stable behavior contract for concise inline text completion. Per-request prompt should contain only the bounded paragraph context and a minimal task cue.

The renderer or native service may bound context, but the native service should enforce the final safety budget even if a caller sends a long string. The output normalizer should keep existing cleanup behavior and apply the inline display budget consistently.

Alternative considered: send a larger surrounding document window for better semantic quality. Rejected for this PR because the original feature deliberately uses paragraph-only context for privacy, predictability, and token efficiency.

### Decision 5: Add diagnostics as counters and durations, not logs of content

Diagnostics should be opt-in and safe to leave in development builds. They should report:

- context extraction duration;
- scheduled, cancelled, stale, cache-hit, native-started, native-completed counts;
- native duration where measurable;
- visible suggestion count.

The diagnostics must not include paragraph text or suggestion text. They can be exposed behind a development flag, test seam, or internal controller snapshot.

Alternative considered: verbose console logging. Rejected because it risks leaking document text and creates noisy review output.

### Decision 6: Defer streaming until after the branch is reviewable

Foundation Models streaming can reduce perceived latency or allow early stopping, but it requires a larger native API surface and more UI lifecycle complexity. This optimization pass should not add streaming unless the bounded non-streaming implementation cannot meet manual latency expectations.

Alternative considered: implement streaming ghost text. Rejected for this feature branch because inline completion is short and correctness/cancellation are higher-value review signals.

## Risks / Trade-offs

- Bounded local scanning may mark some valid paragraphs in very large or ambiguous fenced-code contexts as ineligible → Fail closed by showing no suggestion rather than risking editor jank or wrong contexts.
- Short context bounds may reduce suggestion quality for long paragraphs → Keep the budget large enough for the final sentence context and document the trade-off in tests.
- Cancellation support may not interrupt a Foundation Models call immediately depending on framework behavior → Still cancel Swift task state, suppress stale results, and avoid starting additional native work where possible.
- Renderer-side cache stores recent paragraph text in memory → Keep TTL short, size small, process-local only, and never persist to disk.
- Diagnostics can distort timings if too detailed → Use lightweight counters and durations only, disabled by default.

## Migration Plan

1. Add tests for local context extraction, cancellation calls, cache behavior, and bounded prompt/output.
2. Implement renderer context extraction and request lifecycle changes.
3. Extend Electron/preload/native bridge cancellation support.
4. Add bounded prompt handling and in-memory cache.
5. Run existing test/build verification and a macOS native smoke test where available.
6. If problems appear after review, rollback is straightforward: disable cache and cancellation bridge additions while preserving the original request-id stale-result guard.
