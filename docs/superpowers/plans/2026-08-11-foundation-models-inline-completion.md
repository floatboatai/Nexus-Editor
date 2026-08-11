# macOS Foundation Models Inline Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, optional macOS 26+ Apple Silicon Foundation Models inline-completion feature to the Electron demo using a pure Swift SwiftPM Node-API addon.

**Architecture:** Keep all work inside `apps/electron-demo`. SwiftPM builds a dynamic library containing a minimal Node-API C target, a Foundation Models service, and a pure Swift N-API module; Electron main/preload exposes a narrow bridge with a no-op fallback. A renderer-side Nexus plugin uses the existing `cmExtensions`, `handlers.keydown`, and `EditorAPI.replaceRange()` surfaces to debounce paragraph suggestions, render an inline widget, and accept it with Tab without changing `packages/core`.

**Tech Stack:** Swift 6.1+/SwiftPM, Foundation Models, Node-API C headers, Electron IPC/contextBridge, TypeScript, CodeMirror 6 decorations and view plugins, Vitest/jsdom.

## Global Constraints

- Native completion targets macOS 26+ and Apple Silicon only.
- Non-macOS builds and unsupported macOS environments must keep the Electron demo usable.
- The feature is scoped to `apps/electron-demo`; do not modify `packages/core`.
- Suggestions use only the current normal prose paragraph and are requested after 500 ms of idle time.
- Suggestions are hidden in headings, lists, block quotes, code blocks, tables, and Markdown syntax regions.
- Tab accepts only a visible suggestion with one collapsed main selection; otherwise existing Tab behavior remains unchanged.
- Foundation Models receives on-device text only; no cloud API or persisted document text is added.
- Native artifacts and SwiftPM build directories must not be committed.

---

## File map

Create these focused files:

- `apps/electron-demo/native/foundation-models/Package.swift`: SwiftPM products and targets.
- `apps/electron-demo/native/foundation-models/Sources/NodeAPI/include/NodeAPI.h`: minimal public C wrapper that includes Node's `node_api.h`.
- `apps/electron-demo/native/foundation-models/Sources/FoundationModelsCore/FoundationModelsService.swift`: availability, session, prompt, normalization, and native error mapping.
- `apps/electron-demo/native/foundation-models/Sources/FoundationModelsCore/FoundationModelsTypes.swift`: `Availability`, error codes, and pure normalization types/functions.
- `apps/electron-demo/native/foundation-models/Tests/FoundationModelsCoreTests/FoundationModelsCoreTests.swift`: Swift tests for pure core behavior.
- `apps/electron-demo/native/foundation-models/Sources/NodeAddon/Addon.swift`: pure Swift N-API exports and `napi_async_work` lifecycle.
- `apps/electron-demo/native/foundation-models/build.sh`: locate Node headers, build arm64 release library, and copy it into Electron's distributable native directory.
- `apps/electron-demo/native/foundation-models/smoke-test.mjs`: supported-Mac addon export smoke test.
- `apps/electron-demo/native/foundation-models/README.md`: native prerequisites and standalone build instructions.
- `apps/electron-demo/src/renderer/foundation-models.ts`: typed renderer bridge, platform/availability state, and request controller.
- `apps/electron-demo/src/renderer/foundation-models-context.ts`: Markdown paragraph eligibility and request-context helpers.
- `apps/electron-demo/src/renderer/foundation-models-plugin.ts`: CodeMirror widget/state extension and Tab handling.
- `apps/electron-demo/test/foundation-models-context.test.ts`: deterministic Markdown eligibility tests.
- `apps/electron-demo/test/foundation-models-plugin.test.ts`: fake-bridge/controller/widget behavior tests.

Modify these existing files:

- `apps/electron-demo/electron/main.ts`: guarded addon loading, availability/suggest/dispose IPC handlers, and app shutdown disposal.
- `apps/electron-demo/electron/preload.ts`: typed contextBridge methods.
- `apps/electron-demo/src/renderer/bridge.d.ts`: renderer bridge declarations.
- `apps/electron-demo/src/renderer/editor-shell.ts`: register the feature plugin and expose its disposal/update hook.
- `apps/electron-demo/src/renderer/settings.ts`: persisted toggle and platform/availability-aware row.
- `apps/electron-demo/src/renderer/app.ts`: initialize availability, pass settings changes to the feature controller, and dispose it.
- `apps/electron-demo/src/renderer/style.css`: only if the existing theme variables cannot style the inline widget cleanly.
- `apps/electron-demo/package.json`: native build script and packaging inclusion.
- `package.json`: make `build:electron-demo` invoke the Electron package's cross-platform-safe build.
- `.gitignore`: ignore SwiftPM and generated `.node` output without removing existing entries.
- `apps/electron-demo/test/app-handlers.test.ts`: IPC fallback and native handler tests if the current handler test structure can host them; otherwise create a focused test module.
- `apps/electron-demo/README.md` or the nearest existing Electron demo documentation: user-facing feature and build notes.

---

### Task 1: Add the self-contained SwiftPM Node-API package skeleton

**Files:**
- Create: `apps/electron-demo/native/foundation-models/Package.swift`
- Create: `apps/electron-demo/native/foundation-models/Sources/NodeAPI/include/NodeAPI.h`
- Create: `apps/electron-demo/native/foundation-models/Sources/FoundationModelsCore/FoundationModelsTypes.swift`
- Create: `apps/electron-demo/native/foundation-models/Tests/FoundationModelsCoreTests/FoundationModelsCoreTests.swift`
- Create: `apps/electron-demo/native/foundation-models/README.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces a SwiftPM package named `FoundationModelsAddon` with a dynamic library product named `foundation_models`.
- Produces pure Swift types:

```swift
public enum AvailabilityReason: String, Codable {
    case unsupportedOS = "unsupported-os"
    case unsupportedArchitecture = "unsupported-architecture"
    case appleIntelligenceUnavailable = "apple-intelligence-unavailable"
    case modelUnavailable = "model-unavailable"
}

public struct AvailabilityResult: Codable, Equatable {
    public let available: Bool
    public let reason: AvailabilityReason?
}

public enum SuggestionNormalization {
    public static func normalize(_ raw: String) -> String?
}
```

- Consumes `NODE_INCLUDE` from the environment and fails fast when it is unset or empty.

- [ ] **Step 1: Write failing Swift tests for normalized results and availability encoding.**

```swift
func testEmptyOrWhitespaceSuggestionBecomesNil() {
    XCTAssertNil(SuggestionNormalization.normalize(" \n  "))
}

func testSuggestionRemovesWrappingCodeFenceAndNewlines() {
    XCTAssertEqual(
        SuggestionNormalization.normalize("```\nA short sentence.\n```") ,
        "A short sentence."
    )
}

func testAvailabilityEncodesStableReasonValue() throws {
    let value = AvailabilityResult(available: false, reason: .unsupportedOS)
    let data = try JSONEncoder().encode(value)
    XCTAssertTrue(String(decoding: data, as: UTF8.self).contains("unsupported-os"))
}
```

- [ ] **Step 2: Run the focused Swift test and verify it fails because the package/types do not exist.**

Run: `swift test --package-path apps/electron-demo/native/foundation-models`

Expected: FAIL during package/test compilation with missing type or test target errors.

- [ ] **Step 3: Define the SwiftPM targets and implement only the pure types/normalization required by the tests.**

The `Package.swift` must declare macOS 26 as the native platform, a `foundation_models` dynamic library product, a `NodeAPI` C target, a `FoundationModelsCore` target, and a test target. Do not add external Swift dependencies.

`NodeAPI.h` must contain only the guarded `#include <node_api.h>` wrapper; do not vendor the full Node header.

Normalization must trim whitespace, collapse line breaks to spaces, remove one outer Markdown code fence, and return `nil` for empty output. Limit normalized output to 300 Unicode scalars by truncating at a word boundary when possible.

- [ ] **Step 4: Run the focused Swift tests and verify they pass.**

Run: `swift test --package-path apps/electron-demo/native/foundation-models`

Expected: PASS for all pure core tests.

- [ ] **Step 5: Commit the self-contained SwiftPM skeleton.**

```bash
git add apps/electron-demo/native/foundation-models .gitignore
git commit -m "feat(electron): add SwiftPM Foundation Models package"
```

### Task 2: Implement the Foundation Models service and native availability mapping

**Files:**
- Create: `apps/electron-demo/native/foundation-models/Sources/FoundationModelsCore/FoundationModelsService.swift`
- Modify: `apps/electron-demo/native/foundation-models/Sources/FoundationModelsCore/FoundationModelsTypes.swift`
- Modify: `apps/electron-demo/native/foundation-models/Sources/FoundationModelsCore/FoundationModelsCoreTests.swift`

**Interfaces:**
- Produces:

```swift
public actor FoundationModelsService {
    public init()
    internal init(modelProvider: ModelProvider)
    public func availability() -> AvailabilityResult
    public func suggest(for paragraph: String) async throws -> String?
    public func dispose()
}
```

- `availability()` maps OS/architecture/model state to the stable `AvailabilityResult` without throwing for normal unavailability.
- `suggest(for:)` uses a `LanguageModelSession` and a prompt that requests exactly one next plain-text sentence. It returns normalized text or `nil`.
- Consumes `SystemLanguageModel.default` and `LanguageModelSession` from Foundation Models; all model-specific error details are converted to stable internal error codes before the addon boundary.

- [ ] **Step 1: Add failing tests for the prompt contract and service-level error mapping seams.**

Test the pure prompt builder, not the system model:

```swift
func testPromptRequestsOnePlainTextNextSentence() {
    let prompt = CompletionPrompt.make(for: "Draft notes about native APIs.")
    XCTAssertTrue(prompt.contains("one short next sentence"))
    XCTAssertTrue(prompt.contains("plain text"))
    XCTAssertTrue(prompt.contains("Draft notes about native APIs."))
}

func testUnavailableModelDoesNotProduceACompletion() async {
    let service = FoundationModelsService(modelProvider: .unavailable(.modelUnavailable))
    XCTAssertNil(try? await service.suggest(for: "A paragraph."))
}
```

- [ ] **Step 2: Run the focused Swift tests and verify the new tests fail.**

Run: `swift test --package-path apps/electron-demo/native/foundation-models`

Expected: FAIL because `CompletionPrompt` and the injectable model provider are not implemented.

- [ ] **Step 3: Implement the prompt builder, injectable provider seam, availability mapping, and actor-backed session.**

Keep the provider seam internal to the testable core so production uses `SystemLanguageModel.default` while tests never require Apple Intelligence. The production prompt must state that the input is only the current paragraph and must return no explanation, no quotation marks, no Markdown syntax, and no multiple alternatives.

Reuse one session while the service is alive. On a new request, cancel the previous generation task before starting the next one. Treat model unavailable, context-size, and generation failures as `nil` at the completion-service level; reserve thrown errors for programmer/bridge failures that the addon can report.

- [ ] **Step 4: Run Swift tests and verify they pass.**

Run: `swift test --package-path apps/electron-demo/native/foundation-models`

Expected: PASS without requiring a real model.

- [ ] **Step 5: Commit the Foundation Models service.**

```bash
git add apps/electron-demo/native/foundation-models/Sources/FoundationModelsCore
git commit -m "feat(electron): add Foundation Models completion service"
```

### Task 3: Expose the service through a pure Swift N-API addon

**Files:**
- Create: `apps/electron-demo/native/foundation-models/Sources/NodeAddon/Addon.swift`
- Create: `apps/electron-demo/native/foundation-models/build.sh`
- Modify: `apps/electron-demo/native/foundation-models/Package.swift`
- Modify: `apps/electron-demo/native/foundation-models/README.md`

**Interfaces:**
- Produces the `.node` module exports:

```ts
type NativeAvailability = {
  available: boolean;
  platform: "macos";
  minimumOS: "26.0";
  reason?: "unsupported-os" | "unsupported-architecture" |
    "apple-intelligence-unavailable" | "model-unavailable";
};

declare const native: {
  getAvailability(): Promise<NativeAvailability>;
  suggest(input: string): Promise<string | null>;
  dispose(): void;
};
```

- `Addon.swift` registers `napi_register_module_v1`, validates string arguments, creates Promise/deferred values, and uses `napi_async_work` for `suggest` and availability. N-API calls occur only on the JS/complete callback side; the worker only interacts with Swift service state.
- `build.sh` validates Node headers, calls `swift build --configuration release --product foundation_models`, copies the resulting `libfoundation_models.dylib` to `build/Release/foundation_models.node`, and copies the artifact to `dist-electron/native/foundation_models.node` for packaging.

- [ ] **Step 1: Write a native contract test or executable smoke test for module exports.**

Add a Swift-independent Node smoke script at `apps/electron-demo/native/foundation-models/smoke-test.mjs` that is run only after a supported native build:

```js
const { createRequire } = await import("node:module");
const native = createRequire(import.meta.url)("./build/Release/foundation_models.node");
const availability = await native.getAvailability();
if (typeof availability.available !== "boolean") throw new Error("bad availability");
if ((await native.suggest("A short paragraph.")) !== null && availability.available === false) {
  throw new Error("unavailable model returned a suggestion");
}
native.dispose();
```

- [ ] **Step 2: Run the smoke test before implementation and verify it fails because the artifact is absent.**

Run on a supported Mac: `node apps/electron-demo/native/foundation-models/smoke-test.mjs`

Expected: FAIL with a missing `.node` module error.

- [ ] **Step 3: Implement direct Swift N-API exports and the build script.**

Use the `InvoiceOCR` pattern: retain a Swift work context with `Unmanaged`, keep the deferred Promise in that context, resolve on the complete callback, release the async work, and free any allocated native buffers. The addon must not expose Swift objects or C++ wrappers to JavaScript.

Use `process.arch`/SwiftPM target settings to produce arm64 only. If invoked on a non-darwin host, `build.sh` must print a clear skip message and exit 0 so the cross-platform Electron build remains usable.

- [ ] **Step 4: Run the native build and smoke test on the supported Mac.**

Run: `apps/electron-demo/native/foundation-models/build.sh`

Expected: release `.node` artifact is created and copied into `apps/electron-demo/dist-electron/native/`; the smoke test returns a structured availability object and does not crash when the model is unavailable.

- [ ] **Step 5: Commit the pure Swift addon.**

```bash
git add apps/electron-demo/native/foundation-models
git commit -m "feat(electron): expose Foundation Models through Swift N-API"
```

### Task 4: Add guarded Electron IPC and typed preload fallback

**Files:**
- Modify: `apps/electron-demo/electron/main.ts`
- Modify: `apps/electron-demo/electron/preload.ts`
- Modify: `apps/electron-demo/src/renderer/bridge.d.ts`
- Modify: `apps/electron-demo/test/app-handlers.test.ts` or create `apps/electron-demo/test/foundation-models-bridge.test.ts`

**Interfaces:**
- Adds `window.nexusDemo.foundationModels`:

```ts
interface FoundationModelsBridge {
  getAvailability(): Promise<NativeAvailability>;
  suggest(input: string): Promise<string | null>;
}
```

- Main-process internal loader returns `{ getAvailability, suggest, dispose }` and falls back to:

```ts
const unavailable = {
  async getAvailability() {
    return { available: false, platform: "macos", minimumOS: "26.0", reason: "model-unavailable" };
  },
  async suggest() { return null; },
  dispose() {}
};
```

- IPC channels are `foundation-models:availability` and `foundation-models:suggest`; renderer never receives `ipcRenderer`.

- [ ] **Step 1: Write failing bridge tests for missing addon and IPC forwarding.**

Cover these concrete cases:

```ts
it("returns unavailable instead of throwing when the native module is absent", async () => {
  const bridge = createFoundationModelsBridge({ native: null, platform: "darwin" });
  await expect(bridge.getAvailability()).resolves.toMatchObject({ available: false });
});

it("forwards a suggestion request to the native service", async () => {
  const native = { getAvailability: vi.fn(), suggest: vi.fn().mockResolvedValue("next sentence."), dispose: vi.fn() };
  const bridge = createFoundationModelsBridge({ native, platform: "darwin" });
  await expect(bridge.suggest("paragraph")).resolves.toBe("next sentence.");
  expect(native.suggest).toHaveBeenCalledWith("paragraph");
});
```

- [ ] **Step 2: Run the focused bridge tests and verify they fail.**

Run: `pnpm exec vitest run apps/electron-demo/test/foundation-models-bridge.test.ts`

Expected: FAIL because the loader/bridge functions do not exist.

- [ ] **Step 3: Implement guarded loading, IPC handlers, contextBridge methods, and declarations.**

Resolve the native path for development and packaged builds, catch `require` failures, and log one concise diagnostic without making it a renderer error. Register `ipcMain.handle` handlers next to existing IPC handlers. Dispose the native service from `before-quit` and ensure disposal is idempotent.

- [ ] **Step 4: Run bridge tests and existing Electron tests.**

Run: `pnpm exec vitest run apps/electron-demo/test/foundation-models-bridge.test.ts apps/electron-demo/test/app-handlers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Electron bridge.**

```bash
git add apps/electron-demo/electron apps/electron-demo/src/renderer/bridge.d.ts apps/electron-demo/test
git commit -m "feat(electron): bridge Foundation Models availability and suggestions"
```

### Task 5: Implement pure Markdown paragraph eligibility and request context

**Files:**
- Create: `apps/electron-demo/src/renderer/foundation-models-context.ts`
- Create: `apps/electron-demo/test/foundation-models-context.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SuggestionContext {
  from: number;
  to: number;
  paragraph: string;
}

export function findSuggestionContext(document: string, position: number): SuggestionContext | null;
```

- The returned range is the current paragraph's source range and `to === position`.
- The function rejects blank paragraphs, non-terminal cursors, headings, list markers, block quotes, fenced code, table rows/separators, and positions inside link/image/code/emphasis syntax.
- It does not parse or mutate the document and is safe to test as a pure function.

- [ ] **Step 1: Write failing tests for each accepted/rejected Markdown shape.**

Include at least:

```ts
expect(findSuggestionContext("A normal paragraph", 18)?.paragraph).toBe("A normal paragraph");
expect(findSuggestionContext("# Heading", 9)).toBeNull();
expect(findSuggestionContext("- list item", 11)).toBeNull();
expect(findSuggestionContext("> quoted", 8)).toBeNull();
expect(findSuggestionContext("```\ncode\n```", 8)).toBeNull();
expect(findSuggestionContext("| a | b |", 9)).toBeNull();
expect(findSuggestionContext("A [link](url)", 5)).toBeNull();
expect(findSuggestionContext("A normal paragraph", 5)).toBeNull();
```

- [ ] **Step 2: Run the focused tests and verify they fail.**

Run: `pnpm exec vitest run apps/electron-demo/test/foundation-models-context.test.ts`

Expected: FAIL because `findSuggestionContext` is not implemented.

- [ ] **Step 3: Implement line/paragraph scanning and syntax guards.**

Split around blank lines to find the paragraph, require that the cursor is exactly at its end, and reject structural prefixes on every line. Track fenced-code state from the document start. For inline syntax, reject when the cursor is between unmatched backticks/brackets or when the final paragraph contains a link/image/code token whose source would be changed by appending plain text.

- [ ] **Step 4: Run the focused tests and add edge cases for CRLF and trailing spaces.**

Run: `pnpm exec vitest run apps/electron-demo/test/foundation-models-context.test.ts`

Expected: PASS, including CRLF documents and paragraphs with trailing spaces.

- [ ] **Step 5: Commit the pure context detector.**

```bash
git add apps/electron-demo/src/renderer/foundation-models-context.ts apps/electron-demo/test/foundation-models-context.test.ts
git commit -m "feat(electron): detect safe Foundation Models paragraph contexts"
```

### Task 6: Add the CodeMirror inline suggestion plugin and controller

**Files:**
- Create: `apps/electron-demo/src/renderer/foundation-models.ts`
- Create: `apps/electron-demo/src/renderer/foundation-models-plugin.ts`
- Create: `apps/electron-demo/test/foundation-models-plugin.test.ts`
- Modify: `apps/electron-demo/src/renderer/editor-shell.ts`

**Interfaces:**
- Produces:

```ts
export interface FoundationModelsController {
  setEnabled(enabled: boolean): void;
  setAvailability(availability: NativeAvailability): void;
  clear(): void;
  dispose(): void;
}

export function createFoundationModelsPlugin(options: {
  bridge: FoundationModelsBridge;
  enabled: boolean;
  availability: NativeAvailability;
  onStateChange?: () => void;
}): NexusPlugin & { controller: FoundationModelsController };
```

- Consumes `findSuggestionContext`, `window.nexusDemo.foundationModels`, and the existing `NexusPlugin` surfaces.
- Produces a plugin with a `ViewPlugin`/state field decoration and a `handlers.keydown` handler. The widget is inline, non-editable, gray, and rendered at the document position `to`.
- Uses `EditorAPI.replaceRange(from, to, suggestion, { anchor: to + suggestion.length })` so acceptance is one normal transaction and one undo step.

- [ ] **Step 1: Write failing tests for request debounce, stale results, widget state, and Tab acceptance.**

Use a fake bridge and fake timers. Cover:

```ts
it("requests after 500ms only for an eligible paragraph", async () => {
  vi.useFakeTimers();
  const bridge = createFakeBridge("next sentence.");
  const { editor, controller } = createTestFeature(bridge, "A paragraph");
  editor.setSelection(11);
  vi.advanceTimersByTime(499);
  expect(bridge.suggest).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  await vi.runAllTimersAsync();
  expect(bridge.suggest).toHaveBeenCalledWith("A paragraph");
  controller.dispose();
});

it("does not show a late result after the user edits", async () => {
  const pending = deferred<string | null>();
  const bridge = createFakeBridge(pending.promise);
  const { editor, controller } = createTestFeature(bridge, "A paragraph");
  editor.setSelection(11);
  await flushDebounce();
  editor.replaceRange(11, 11, "!");
  pending.resolve("stale");
  await flushPromises();
  expect(document.querySelector(".nexus-foundation-suggestion")).toBeNull();
  controller.dispose();
});

it("accepts only a collapsed single selection with Tab", async () => {
  const { editor, dispatchKeydown } = await createTestFeatureWithSuggestion("next.");
  expect(dispatchKeydown(new KeyboardEvent("keydown", { key: "Tab" }))).toBe(true);
  expect(editor.getDocument()).toBe("A paragraphnext.");
});
```

Also test `null`, Escape, blur, selection-preserving Tab behavior, disabled/unavailable state, and disposal.

- [ ] **Step 2: Run the focused plugin tests and verify they fail.**

Run: `pnpm exec vitest run apps/electron-demo/test/foundation-models-plugin.test.ts`

Expected: FAIL because the controller/plugin and test harness do not exist.

- [ ] **Step 3: Implement the controller with request ids and timer cleanup.**

Use one timer and one monotonically increasing request id. On each editor update, clear the widget before scheduling a new request. Capture the paragraph range and current document/selection; only render a result when the request id, document text, and collapsed selection still match. Treat bridge rejection as a silent completion failure and leave the editor usable.

- [ ] **Step 4: Implement the inline decoration and keydown handler.**

The widget DOM must have class `nexus-foundation-suggestion`, `aria-hidden="true"`, `contenteditable="false"`, and theme-aware muted color. The keydown handler must return `true` only for Tab with a visible suggestion and exactly one collapsed main selection; call `preventDefault` through the existing editor event path and use `replaceRange` for insertion. Escape clears and returns `true`; all other paths return `false`.

- [ ] **Step 5: Register the plugin from `editor-shell.ts` and run focused tests.**

Create the plugin before `createEditor`, add it to the existing `plugins` array, expose its controller on the returned `EditorShell`, and call `controller.clear()` before `loadDocument` content replacement. Ensure `destroy()` disposes timers, pending state, and the native bridge reference. Run:

`pnpm exec vitest run apps/electron-demo/test/foundation-models-plugin.test.ts apps/electron-demo/test/editor-shell.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the renderer completion interaction.**

```bash
git add apps/electron-demo/src/renderer/foundation-models.ts apps/electron-demo/src/renderer/foundation-models-plugin.ts apps/electron-demo/src/renderer/editor-shell.ts apps/electron-demo/test/foundation-models-plugin.test.ts
git commit -m "feat(electron): add inline Foundation Models suggestions"
```

### Task 7: Integrate availability and the Settings toggle

**Files:**
- Modify: `apps/electron-demo/src/renderer/settings.ts`
- Modify: `apps/electron-demo/src/renderer/app.ts`
- Modify: `apps/electron-demo/src/renderer/editor-shell.ts`
- Modify: `apps/electron-demo/test/state.test.ts` or create `apps/electron-demo/test/foundation-models-settings.test.ts`

**Interfaces:**
- Add `foundationModelsSuggestions: boolean` to `EditorSettings`, default `true`.
- Add `FoundationModelsSettingsState` with `platform`, `availability`, and `enabled` values so the panel can render without re-probing the system.
- `createSettingsPanel(settings, onChange, options?)` accepts an optional availability/platform object; omitting it preserves existing callers.

- [ ] **Step 1: Write failing settings tests for defaults, persistence, hidden non-macOS, and disabled unavailable rows.**

Test exact behavior:

```ts
expect(defaultSettings().foundationModelsSuggestions).toBe(true);
const loaded = loadSettingsAfterPersist({ foundationModelsSuggestions: false });
expect(loaded.foundationModelsSuggestions).toBe(false);
expect(renderSettings({ platform: "linux", availability: null })).not.toContain("Foundation Models");
expect(renderSettings({ platform: "darwin", availability: { available: false, reason: "unsupported-os" } }))
  .toContain("requires macOS 26");
```

- [ ] **Step 2: Run the focused settings tests and verify they fail.**

Run: `pnpm exec vitest run apps/electron-demo/test/foundation-models-settings.test.ts`

Expected: FAIL because the setting and availability-aware rendering do not exist.

- [ ] **Step 3: Implement settings persistence and conditional UI.**

Keep existing settings merge behavior so older localStorage values receive the new default. Render no row when `platform !== "darwin"`; render a disabled toggle and reason text for unavailable macOS; render a live toggle only when available. Do not allow a disabled control to mutate persisted settings.

- [ ] **Step 4: Initialize and update the controller from `app.ts`.**

Query availability once during app startup, pass the result into the editor shell/plugin, and refresh it when Settings opens. On toggle changes, call `controller.setEnabled(next.foundationModelsSuggestions)` and keep the existing `shell.applySettings` flow. Opening a file or loading a document must clear the suggestion before replacing content.

- [ ] **Step 5: Run settings, app, and editor tests.**

Run: `pnpm exec vitest run apps/electron-demo/test/foundation-models-settings.test.ts apps/electron-demo/test/state.test.ts apps/electron-demo/test/editor-shell.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the settings integration.**

```bash
git add apps/electron-demo/src/renderer/settings.ts apps/electron-demo/src/renderer/app.ts apps/electron-demo/src/renderer/editor-shell.ts apps/electron-demo/test
git commit -m "feat(electron): add Foundation Models suggestion setting"
```

### Task 8: Wire build scripts, packaging, documentation, and complete verification

**Files:**
- Modify: `apps/electron-demo/package.json`
- Modify: `package.json`
- Modify: `apps/electron-demo/README.md` or add `apps/electron-demo/native/foundation-models/README.md` sections if no app README exists
- Modify: `.gitignore`
- Modify: `apps/electron-demo/test/app-handlers.test.ts` if packaging/IPC coverage belongs there

**Interfaces:**
- `pnpm --filter @floatboat/nexus-electron-demo native:build` invokes the native script and safely no-ops off macOS.
- `pnpm --filter @floatboat/nexus-electron-demo build` runs the native build before `tsup`/Vite on supported macOS and still builds renderer/main on other platforms.
- Electron-builder includes `dist-electron/native/foundation_models.node` when it exists.

- [ ] **Step 1: Write a packaging/build assertion before changing scripts.**

Add a test or shell assertion that the Electron build directory contains `dist-electron/native/foundation_models.node` after a supported native build and that a non-darwin invocation exits successfully without creating a fake native binary.

- [ ] **Step 2: Run the assertion and verify it fails with the current scripts.**

Run: `pnpm --filter @floatboat/nexus-electron-demo native:build`

Expected: FAIL because no native script/output path is currently defined.

- [ ] **Step 3: Implement cross-platform-safe scripts and packaging.**

Add an explicit `native:build` script that calls `native/foundation-models/build.sh`. Make the root/electron build order run this script before the existing JavaScript build. Keep the shell script's non-darwin exit 0 behavior. Ensure electron-builder's existing `dist-electron/**/*` file rule captures the copied addon without adding source or SwiftPM build directories to the package.

- [ ] **Step 4: Write README instructions and limitations.**

Document:

```text
Supported native completion: macOS 26+, Apple Silicon, Apple Intelligence/Foundation Models available.
Prerequisites: Xcode Command Line Tools, Swift toolchain, Node.js headers.
Build: pnpm --filter @floatboat/nexus-electron-demo native:build
Run: pnpm dev:electron-demo
Fallback: non-macOS hides the setting; unsupported macOS disables it; missing addon never blocks startup.
```

Include manual verification steps for typing at a normal paragraph end, waiting 500 ms, accepting with Tab, testing null/unavailable behavior, and confirming Escape/selection/undo behavior.

- [ ] **Step 5: Run the complete cross-platform verification suite.**

Run:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm build:electron-demo
```

Expected: PASS without requiring Swift/Xcode on non-macOS; on the supported Mac, also run:

```bash
apps/electron-demo/native/foundation-models/build.sh
pnpm --filter @floatboat/nexus-electron-demo build
pnpm --filter @floatboat/nexus-electron-demo start
```

Manually verify all interaction paths: normal paragraph suggestion, Tab acceptance, null result, new-input cancellation, cursor movement, Escape, selection-preserving Tab, disabled setting, unavailable model, document load, undo, and application quit.

- [ ] **Step 6: Run final diff checks and commit documentation/build integration.**

```bash
git diff --check
git status --short
git add package.json apps/electron-demo/package.json apps/electron-demo/README.md .gitignore apps/electron-demo/test
git commit -m "docs(electron): document Foundation Models completion build"
```

Expected: only intentional feature files and commits are present; no `.node`, `.build`, `dist-electron`, or `.superpowers` artifacts are staged.

## Final review checklist

- [ ] Spec requirements map to Tasks 1–8.
- [ ] Pure Swift N-API path is used; no Objective-C++ or `node-addon-api` dependency was introduced.
- [ ] No `packages/core` changes are present.
- [ ] Native loading failures and unsupported availability are non-fatal.
- [ ] The renderer never sends more than the current paragraph and never displays stale results.
- [ ] Tab behavior is unchanged unless a visible suggestion exists with one collapsed main cursor.
- [ ] Cross-platform typecheck, tests, and builds pass before claiming completion.
- [ ] Supported-Mac manual verification evidence is recorded in the PR description.
