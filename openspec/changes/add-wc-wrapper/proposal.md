# Change: Add framework-agnostic Web Component and iframe wrappers (`@floatboat/nexus-wc`)

## Why
Nexus-Editor ships React and Vue bindings, but teams using Web Components, vanilla JS, other frameworks, or an isolated iframe have no first-class way to embed the engine without hand-rolling `createEditor` lifecycle and cross-window messaging. Roadmap item 22 (`docs/ROADMAP.md`) calls for a `wc` package that shares the core instance model with the existing SDKs.

## What Changes
- **ADDED** new package `packages/wc` (`@floatboat/nexus-wc`) exporting a `<nexus-editor>` custom element and a `defineNexusEditor(tagName?)` registration helper
- **ADDED** attribute/property surface mirroring `EditorConfig`: `initial-value` / `value` (controlled, synced via `nexus-change`), `read-only`, `tab-size`, `direction`, `indent-guides`, `live-preview`, `slash-menu-limit`, `parse-delay-ms` as attributes; `plugins`, `parser`, `theme`, `locale`, `onAssetUpload` as JS-only properties (object/function-valued, no attribute equivalent)
- **ADDED** custom events: `nexus-ready`, `nexus-change`, `nexus-focus`, `nexus-blur`, `nexus-selectionchange`, `nexus-slashmenuchange` — namespaced to avoid colliding with native `change`/`focus`/`blur`
- **ADDED** `.editor` property exposing the live `EditorAPI` instance (`null` before `connectedCallback` runs)
- **ADDED** parent and runtime iframe entry points using an origin-checked `MessageChannel` bridge for ready/change, document get/set, focus, and destroy
- **HARDENED** delayed controlled-value synchronization, custom-element upgrade/reparent lifecycle, and composed event delivery across consumer-owned shadow roots

## Impact
- Affected specs: new `wc` capability
- Affected code: new `packages/wc/**` plus the shared delayed-change path in `packages/core`
- No breaking changes; zero new runtime dependencies (only a workspace dependency on `@floatboat/nexus-core`)
