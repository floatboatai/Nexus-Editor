## Context

The wrapper must be usable by any browser host without React or Vue, while retaining the existing `EditorAPI` as the sole editor state owner. CodeMirror supports an explicit `Document | ShadowRoot` root, which is required when the editor DOM is mounted inside an element's ShadowRoot.

## Goals

- Provide an autonomous custom element with deterministic connect/disconnect ownership.
- Keep Markdown as a string property and emit native composed CustomEvents.
- Isolate host CSS with an open ShadowRoot while preserving CodeMirror DOM behavior.
- Keep plugin configuration as a JavaScript property rather than attempting to serialize functions into attributes.

## Non-Goals

- Providing a default toolbar, slash menu, file picker, local storage, or product-level UI.
- Adding an iframe RPC protocol or remote plugin loading.
- Replacing the React or Vue bindings.
- Defining HTML attributes for parser, plugins, upload callbacks, or runtime ownership.

## Decisions

### Opt-in registration

The package exports `defineNexusEditorElement(tagName = "nexus-editor")`. Importing the package does not mutate `customElements`; hosts choose the tag name and registration time. Repeated registration for the same constructor is a no-op, while a conflicting already-defined constructor throws a clear error.

### ShadowRoot and core root option

`NexusEditorElement` creates an open ShadowRoot containing one mount element. Core gains optional `EditorConfig.root?: Document | ShadowRoot` and passes it to CodeMirror's `EditorView`. This preserves correct selection, event, and style behavior in the ShadowRoot without adding wrapper-specific logic to the editor engine.

### Value and event semantics

`value` is the controlled Markdown property. A value change originating outside the editor calls `setDocument(value, { silent: true })` and MUST NOT dispatch `nexus-change`. A user-originated `onChange` dispatches `nexus-change` with `{ value, ast }`; the event is `bubbles: true` and `composed: true` so it crosses the ShadowRoot boundary. `initialValue` is read only for the first editor creation.

### Ownership lifecycle

`connectedCallback()` creates at most one `EditorAPI` and dispatches `nexus-ready` after creation. `disconnectedCallback()` destroys the owned editor and clears its reference. Reconnection creates a new editor using the current `value`, not stale instance state. Attribute reflection never creates or destroys an editor.

## Risks and Mitigations

- ShadowRoot styling or input regressions: add a real Chromium browser test in addition to jsdom lifecycle tests.
- Reconnect churn: test repeated append/remove cycles and exactly-once `destroy()` behavior.
- Event feedback loops: test silent external updates separately from user input.
- Public API growth: keep the first release to four scalar properties plus two events and `getEditor()`.

## Migration Plan

The package is additive. Existing core, React, and Vue users do not change imports or configuration. Hosts may adopt the new package independently.
