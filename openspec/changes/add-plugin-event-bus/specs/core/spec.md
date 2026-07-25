## ADDED Requirements
### Requirement: Plugin Event Bus
The editor core SHALL provide a shared event bus accessible to all plugins
via `EditorAPI.getEventBus()`. Plugins MAY emit typed events and subscribe
to events from other plugins or from the core.

#### Scenario: Plugin subscribes to document change event
- **WHEN** a plugin calls `bus.on("document.change", handler)` in `onInit`
- **THEN** the handler SHALL be called with the new document string and AST
  every time the document content changes

#### Scenario: Plugin emits a custom event
- **WHEN** a plugin calls `bus.emit("myPlugin.ready", { status: "loaded" })`
- **THEN** any subscriber to `"myPlugin.ready"` SHALL receive the payload

#### Scenario: Unsubscribing stops event delivery
- **WHEN** a plugin calls `bus.off("event.name", handler)`
- **THEN** the removed handler SHALL NOT be called on subsequent emits

### Requirement: Plugin Initialization Hook
The `NexusPlugin` interface SHALL support an optional `onInit` callback
that receives the `EditorAPI` instance. This hook is called after the
editor is fully constructed, giving plugins access to the event bus and
editor API for subscription setup.

#### Scenario: Plugin subscribes in onInit
- **WHEN** a plugin defines `onInit(api)` that calls `api.getEventBus().on(...)`
- **THEN** the subscription SHALL be active for the editor's lifetime

### Requirement: Built-in Core Events
The editor core SHALL emit the following events on the plugin event bus:

| Event | Payload | When |
|-------|---------|------|
| `document.change` | `{ doc: string, ast: Root }` | Document content changes |
| `focus` | `{}` | Editor gains focus |
| `blur` | `{}` | Editor loses focus |
| `selection.change` | `{ anchor: number, head: number }` | Selection changes |

#### Scenario: Core event is emitted on change
- **WHEN** the user types a character in the editor
- **THEN** `document.change` event SHALL be emitted on the plugin event bus
  with the updated document string and AST
