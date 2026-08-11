# macOS Foundation Models Inline Completion

## Summary

Add an optional macOS-only inline completion feature to the Electron demo. On macOS 26+ Apple Silicon devices where Apple Foundation Models is available, Nexus Editor suggests the next sentence for a normal Markdown paragraph after the user pauses. The suggestion appears in gray at the paragraph end and is accepted with Tab. The feature is disabled from Settings when unavailable and is hidden on non-macOS platforms.

The change is intentionally scoped to `apps/electron-demo`; the reusable editor packages remain platform-neutral.

## Goals

- Demonstrate a real Swift/SwiftPM Node-API addon using Foundation Models.
- Keep the Electron application usable when the native feature cannot be built or loaded.
- Provide a predictable inline completion interaction with correct CodeMirror editing semantics.
- Keep user text on-device and avoid cloud APIs or account configuration.
- Make the PR reproducible for reviewers with documented build and verification commands.

## Non-goals

- No changes to `packages/core` or the public editor package API.
- No Windows/Linux native implementation.
- No suggestions inside headings, lists, block quotes, code blocks, tables, or Markdown syntax regions.
- No multi-suggestion UI, completion history, cloud fallback, or document-wide semantic context.
- No requirement for real Foundation Models calls in cross-platform CI.

## Supported environments

- Native completion: macOS 26 or newer, Apple Silicon, Apple Intelligence/Foundation Models available.
- macOS on an older system, Intel macOS, or unavailable model: application remains usable and the Settings control is disabled with a reason.
- Non-macOS: the feature setting is hidden and a no-op implementation preserves the same renderer-facing interface.

## Architecture

The feature is contained in the Electron demo:

```text
apps/electron-demo/
├── native/foundation-models/
│   ├── Package.swift
│   ├── Sources/NodeAPI/              # minimal SwiftPM C target for node_api.h
│   ├── Sources/FoundationModelsCore/ # Foundation Models service
│   ├── Sources/NodeAddon/             # pure Swift N-API exports
│   └── build.sh
├── electron/
│   ├── main.ts                        # addon loading and IPC handlers
│   └── preload.ts                     # narrow renderer bridge
└── src/renderer/
    ├── foundation-models.ts           # availability and request controller
    ├── suggestion-widget.ts           # CodeMirror inline decoration
    └── settings.ts                    # preference and availability UI
```

The data flow is:

```text
CodeMirror document/selection update
  → renderer checks paragraph and debounces for 500 ms
  → preload.foundationModels.suggest(paragraph)
  → Electron main IPC
  → pure Swift N-API Promise
  → Foundation Models LanguageModelSession
  → string, null, or structured error
  → renderer validates request id
  → gray inline widget
  → Tab dispatches one editor transaction
```

The Node addon exposes only model-facing operations. It does not know about CodeMirror, Markdown, settings, or DOM state.

## Native addon design

SwiftPM provides three targets:

- `NodeAPI`: a minimal C target exposing Node's `node_api.h` to Swift.
- `FoundationModelsCore`: availability checks, session lifecycle, prompt construction, result normalization, and native error mapping.
- `NodeAddon`: pure Swift N-API registration and Promise/async-work plumbing.

The addon API is:

```ts
interface NativeFoundationModels {
  getAvailability(): Promise<{
    available: boolean;
    platform: "macos";
    minimumOS: "26.0";
    reason?:
      | "unsupported-os"
      | "unsupported-architecture"
      | "apple-intelligence-unavailable"
      | "model-unavailable";
  }>;

  suggest(input: string): Promise<string | null>;
  dispose(): void;
}
```

The implementation follows the existing InvoiceOCR addon pattern: SwiftPM builds a dynamic library, the build script places it at the Electron addon's expected `.node` path, and Swift registers `napi_register_module_v1` directly. `napi_async_work` keeps model generation off the Node event loop; N-API calls happen only in the appropriate callback phase.

`SystemLanguageModel` determines availability. When available, a completion-specific `LanguageModelSession` generates one short next sentence. The prompt requires plain text only: no explanation, Markdown, quotation marks, or multiple alternatives. Empty output is normalized to `null`; output is trimmed, constrained to a practical maximum length, and stripped of accidental code fences or line breaks.

Availability is normal state, not an exception. Invalid arguments, addon loading failures, context exhaustion, and model failures use stable error codes. Native completion does not persist document text or send it over the network.

## Electron bridge and fallback

The main process loads the native module only on supported macOS builds. Loading or calling the addon is guarded so that a missing `.node`, a failed Swift build, or an unexpected native error cannot prevent the Electron window from opening.

The preload exposes a narrow, typed bridge with availability, suggest, and dispose operations. Renderer code never receives the raw native module.

On non-macOS, the same bridge contract resolves availability as unavailable and `suggest()` as `null`. This keeps platform checks out of most renderer logic and makes tests deterministic.

## Renderer interaction

The suggestion controller observes document changes, selection changes, focus, and settings. It requests completion only when all conditions hold:

- one main cursor with no selection;
- cursor at the end of a normal prose paragraph;
- cursor is not in a heading, list, block quote, code block, table, or Markdown syntax token;
- the feature is enabled and native availability is `available`.

After 500 ms without input, the controller sends only the current paragraph as context. New input, cursor movement, blur, Escape, settings changes, or a new request immediately removes the visible suggestion. Each request has a monotonically increasing id; late results are discarded if their id is no longer current.

The suggestion is a CodeMirror inline widget/decoration at the current document position. It uses theme variables so gray text remains legible in light and dark mode, and it follows wrapping, scrolling, font changes, and zoom without absolute positioning.

Tab is consumed only when a suggestion is visible, there is one main cursor, and there is no selection. Acceptance inserts the suggestion through one normal editor transaction, clears the widget, and creates one undoable edit. If there is a selection or no suggestion, CodeMirror's existing Tab behavior is preserved. Escape clears only the current suggestion. A `null` native result produces no widget and does not change Tab behavior.

## Settings

Add `foundationModelsSuggestions: boolean` to the existing persisted `EditorSettings`, defaulting to enabled when supported.

In the Behavior section:

- non-macOS: do not render the setting;
- macOS but unavailable: render a disabled control with a concise reason;
- macOS and available: render an enabled toggle;
- toggling off stops requests and removes any visible suggestion;
- the value is persisted through the existing localStorage settings flow.

Availability is checked at application startup and when the Settings panel opens, not on every keystroke.

## Testing and verification

Cross-platform renderer tests cover:

- valid prose paragraph detection and 500 ms debounce;
- rejection of headings, lists, quotes, code, tables, and Markdown syntax;
- cancellation/late-result protection;
- `null` results and no-op Tab behavior;
- acceptance with a single empty selection;
- preservation of Tab behavior when a selection exists;
- Escape, blur, focus, and settings toggle behavior;
- platform visibility and disabled availability states.

Swift tests cover prompt/result normalization, empty output handling, availability mapping, and stable error codes. Real model generation is manually verified on macOS 26+ Apple Silicon rather than required in CI.

Build verification includes:

- `pnpm install`, typecheck, tests, and build without Swift/Xcode on non-macOS;
- native `build.sh` producing the `.node` artifact on supported macOS;
- Electron demo build and startup when the addon is absent;
- Electron demo startup and inline acceptance when the addon is available.

Generated `.node`, SwiftPM build directories, and other native artifacts are ignored. README documentation records Xcode Command Line Tools, Node headers, SwiftPM build, supported OS/architecture, fallback behavior, and manual verification steps.

## Completion criteria

The PR is complete when the feature works on a supported Mac, fails safely when Foundation Models is unavailable, remains invisible and harmless on non-macOS, preserves normal editor Tab behavior, passes the cross-platform test/build suite, and includes enough native build documentation for a reviewer to reproduce it.

