# Change: Add a Web Component integration wrapper

## Why

Nexus ships framework-agnostic core APIs plus React and Vue bindings, but hosts using Web Components, Angular, Svelte, CMS embeds, or plain HTML still have to own all mount, teardown, controlled-value, and DOM-event plumbing. A small autonomous Custom Element broadens integration without turning Nexus into a product UI.

## What Changes

- Add a publishable `@floatboat/nexus-wc` package that exposes an opt-in custom-element registration function and `NexusEditorElement` type.
- Add a ShadowRoot-aware `root` option to the core editor configuration so CodeMirror selection and style handling use the correct DOM root.
- Define a minimal element contract: `value`, `initialValue`, `readOnly`, `livePreview`, `getEditor()`, `nexus-ready`, and `nexus-change`.
- Add browser-level verification for ShadowRoot mounting, controlled updates, composed events, and exactly-once teardown.

## Impact

- Affected specs: new `web-component-wrapper` capability; core editor configuration.
- Affected code: `packages/core`, new `packages/wc`, browser E2E fixture, package documentation, and CI.
- No runtime dependency is introduced beyond existing Nexus core dependencies.
- No product UI, Vault, plugin runtime, iframe protocol, collaboration, or framework-binding behavior changes are in scope.
