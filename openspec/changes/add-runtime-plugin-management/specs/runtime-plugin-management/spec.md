# runtime-plugin-management

## ADDED Requirements

### Requirement: Hook capability classification

The system SHALL classify every `NexusPlugin` hook as either hot-pluggable (`cmExtensions`, `shortcuts`) or construction-time (`widgets`, `remarkPlugins`, `slashCommands`, `commands`, `handlers`), and SHALL only permit runtime installation of plugins whose declared hooks are all hot-pluggable.

#### Scenario: Plugin with only hot-pluggable hooks is accepted

- **WHEN** `addPlugin` is called with a plugin declaring only `cmExtensions` and/or `shortcuts`
- **THEN** the plugin is installed and its extensions take effect without recreating the editor

#### Scenario: Plugin declaring a construction-time hook is rejected

- **WHEN** `addPlugin` is called with a plugin declaring any of `widgets`, `remarkPlugins`, `slashCommands`, `commands`, or `handlers`
- **THEN** an error is thrown that names each offending hook and directs the caller to the static `plugins` configuration
- **AND** the editor state and installed plugin set remain unchanged

### Requirement: Runtime installation via addPlugin

The system SHALL provide `EditorAPI.addPlugin(plugin)` which installs an accepted plugin into the live editor in a single reconfiguration, preserving document content, undo history, selection, and scroll position.

#### Scenario: Extension takes effect immediately

- **WHEN** a plugin with a `cmExtensions` entry (e.g. an update listener) is added
- **THEN** the extension is active for the next editor update without any editor recreation

#### Scenario: Duplicate name is rejected

- **WHEN** `addPlugin` is called with a `name` matching an already-installed plugin (static or runtime)
- **THEN** an error is thrown and the installed plugin set is unchanged

#### Scenario: Destroyed editor rejects installation

- **WHEN** `addPlugin` is called after `destroy()`
- **THEN** an error is thrown

#### Scenario: Failed installation rolls back

- **WHEN** installing a plugin causes the reconfigure dispatch to throw
- **THEN** the plugin is not retained in the registry and the editor remains in its prior working state
- **AND** the error propagates to the caller

### Requirement: Runtime removal via removePlugin

The system SHALL provide `EditorAPI.removePlugin(name)` which uninstalls a runtime-added plugin completely — after removal, none of the plugin's keybindings or extensions remain active.

#### Scenario: Runtime plugin is removed completely

- **WHEN** `removePlugin` is called with the name of a runtime-added plugin
- **THEN** it returns `true` and the plugin's extensions and shortcuts stop taking effect from the next update on

#### Scenario: Unknown name

- **WHEN** `removePlugin` is called with a name that matches no installed plugin
- **THEN** it returns `false` and nothing changes

#### Scenario: Construction-time plugin cannot be removed

- **WHEN** `removePlugin` is called with the name of a plugin supplied in the `createEditor` config
- **THEN** an error is thrown explaining that construction-time plugins require editor recreation

### Requirement: Plugin set introspection and change notification

The system SHALL expose the installed plugin set via `EditorAPI.getPlugins()` (name and origin per plugin) and SHALL emit a `pluginsChange` event with the full set after every successful runtime add or remove.

#### Scenario: Introspection reflects both origins

- **WHEN** an editor is created with one static plugin and one plugin is added at runtime
- **THEN** `getPlugins()` returns both entries, the static one with `runtime: false` and the added one with `runtime: true`

#### Scenario: Change event fires on add and remove

- **WHEN** a runtime plugin is added and later removed
- **THEN** `pluginsChange` fires after each operation with the then-current full plugin list

### Requirement: Demo marketplace policy layer

The Electron demo SHALL present runtime plugin management through a host-owned marketplace-style policy layer, where only curated bundled entries may execute and non-executable marketplace/local entries remain preview-only.

#### Scenario: Bundled runtime plugin can be installed from the marketplace

- **WHEN** the user installs the bundled Typewriter Mode listing from the demo marketplace
- **THEN** the demo dynamically imports the bundled plugin module and calls `addPlugin`
- **AND** the listing reflects installed state using `getPlugins()` and `pluginsChange`

#### Scenario: Placeholder listing does not execute code

- **WHEN** the user views a preview/planned/static-only marketplace listing
- **THEN** the listing is displayed as unavailable or preview-only
- **AND** no plugin module is imported or installed from that listing

#### Scenario: Local folder preview does not load plugin code

- **WHEN** the user selects a local folder from the marketplace local entry point
- **THEN** the demo may display the selected folder path as a preview
- **AND** it MUST NOT import, evaluate, or execute code from that folder
