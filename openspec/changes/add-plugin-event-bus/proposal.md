# Change: Add Plugin Event Bus

## Why
Plugins currently have no way to communicate with each other. The
Outline panel only refreshes on manual toggle, Backlinks don't react
to file switches, and every plugin must poll the EditorAPI. A shared
event bus lets plugins broadcast and listen for typed events, enabling
reactive cross-plugin communication without tight coupling.

## What Changes
- Add a `PluginEventBus` class (wraps `EventEmitter`) to `packages/core`
- Expose `getEventBus()` on `EditorAPI` so plugins can access the bus
- Add `onInit?: (api: EditorAPI) => void` to `NexusPlugin` — called after
  editor construction so plugins can subscribe to events
- Plugins import and call `definePluginEvent<T>(name)` to register typed events
  with payload interfaces, enabling type-safe emit/listen in TypeScript
- Core emits built-in events: `document.change`, `file.open`, `focus`,
  `blur`, `selection.change`
- Zero new runtime dependencies

## Impact
- Affected specs: `core` (new capability: plugin-event-bus)
- Affected code: `packages/core/src/event-emitter.ts`,
  `packages/core/src/editor.ts`, `packages/core/src/types.ts`
- No breaking changes — `onInit` is optional, event bus is additive
