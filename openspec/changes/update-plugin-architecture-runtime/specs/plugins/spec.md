## ADDED Requirements

### Requirement: Plugins SHALL support setup lifecycle context

`NexusPlugin` SHALL support an optional `setup(context)` lifecycle hook. The setup context MUST provide plugin identity, editor handle access, teardown registration, and scoped facades for command bus, event bus, and diagnostics reporting.

#### Scenario: setup hook receives scoped context
- **WHEN** a plugin defines `setup(context)`
- **THEN** the plugin SHALL receive `pluginName`, `editor`, `onDispose`, `commandBus`, `eventBus`, and `diagnostics`

#### Scenario: setup teardown runs on plugin deactivation
- **WHEN** a plugin registers cleanup callbacks in `setup`
- **THEN** those callbacks SHALL run when the plugin is unloaded or when the editor is destroyed

### Requirement: Plugin dependency ordering SHALL be deterministic

The editor SHALL resolve plugin execution order by plugin dependencies declared via `dependsOn`. Missing dependencies and dependency cycles MUST be surfaced through plugin diagnostics.

#### Scenario: dependency chain reorders plugins
- **WHEN** plugin `A` depends on plugin `B`
- **THEN** `B` SHALL be resolved before `A`

#### Scenario: missing dependency emits diagnostic
- **WHEN** a plugin depends on a plugin that is not present
- **THEN** a warning diagnostic SHALL be recorded with a missing-dependency code

#### Scenario: dependency cycle emits diagnostic and fallback
- **WHEN** a cycle exists in dependency declarations
- **THEN** an error diagnostic SHALL be recorded
- **AND** plugin order resolution SHALL fall back to registration order

### Requirement: Runtime plugin management SHALL be available

The editor API SHALL support runtime plugin lifecycle management through active-plugin introspection, activation, deactivation, and reload operations.

#### Scenario: runtime plugin activation
- **WHEN** the host calls `usePlugin(plugin)`
- **THEN** the plugin SHALL be activated and included in active plugin list

#### Scenario: runtime plugin deactivation
- **WHEN** the host calls `unusePlugin(name)` for an active plugin
- **THEN** the plugin SHALL be deactivated
- **AND** setup-owned runtime resources SHALL be cleaned up

#### Scenario: runtime plugin reload
- **WHEN** the host calls `reloadPlugin(name, nextPlugin?)`
- **THEN** the target plugin SHALL be deactivated and reactivated with replacement definition when provided

### Requirement: Command and plugin-event buses SHALL be exposed

The editor API SHALL provide command and plugin-event bus operations for runtime orchestration, and setup-scoped bus facades SHALL be available for plugin-local ownership.

#### Scenario: runtime command registration and execution
- **WHEN** a plugin registers a command through command APIs
- **THEN** the command SHALL be executable via `runCommand(id)`

#### Scenario: plugin event publish/subscribe
- **WHEN** a plugin subscribes to a plugin event and another plugin emits the event
- **THEN** the subscriber SHALL receive the payload

#### Scenario: setup-owned bus resources auto cleanup
- **WHEN** a plugin is unloaded after registering setup-scoped commands/events
- **THEN** setup-owned commands SHALL be removed
- **AND** setup-owned event subscriptions SHALL be detached

### Requirement: Existing static plugins SHALL remain backward-compatible

Existing plugins that only use static contribution fields (`shortcuts`, `commands`, `handlers`, `remarkPlugins`, `cmExtensions`, `widgets`) MUST continue to work without requiring setup migration.

#### Scenario: static plugin remains functional without setup
- **WHEN** a plugin defines no `setup` hook and only static fields
- **THEN** its contributions SHALL continue to work as before
