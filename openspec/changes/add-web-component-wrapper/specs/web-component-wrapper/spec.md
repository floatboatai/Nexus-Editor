## ADDED Requirements

### Requirement: Opt-in custom-element registration

The `@floatboat/nexus-wc` package SHALL export `defineNexusEditorElement(tagName?: string)` and SHALL not register a custom element merely because the package is imported.

#### Scenario: Host registers the default tag
- **WHEN** a host calls `defineNexusEditorElement()` in a browser that has no `nexus-editor` definition
- **THEN** `customElements.get("nexus-editor")` SHALL return the Nexus editor element constructor

#### Scenario: Import does not change the registry
- **WHEN** a host imports `@floatboat/nexus-wc` without calling `defineNexusEditorElement`
- **THEN** the package SHALL not define a custom element

### Requirement: ShadowRoot editor ownership

The registered element SHALL create one owned editor inside an open ShadowRoot while connected and SHALL destroy that editor when disconnected.

#### Scenario: Element connects
- **WHEN** a defined `<nexus-editor>` is appended to a document
- **THEN** it SHALL mount the editor inside its ShadowRoot and dispatch one `nexus-ready` event containing the EditorAPI

#### Scenario: Element disconnects
- **WHEN** a connected `<nexus-editor>` is removed from its document
- **THEN** it SHALL destroy its owned EditorAPI exactly once and `getEditor()` SHALL return `null`

#### Scenario: Element reconnects
- **WHEN** a disconnected `<nexus-editor>` is appended again
- **THEN** it SHALL create a new editor using its current Markdown value

### Requirement: Controlled Markdown property and user-change event

The element SHALL expose controlled Markdown through a `value` property and SHALL separate external replacement from user-originated change notification.

#### Scenario: Host replaces the value
- **WHEN** a connected element receives a changed `value` property
- **THEN** it SHALL silently replace the editor document and SHALL not dispatch `nexus-change`

#### Scenario: User edits content
- **WHEN** a user changes the document through the editor surface
- **THEN** the element SHALL dispatch a bubbling, composed `nexus-change` CustomEvent whose detail contains the current Markdown value and AST

### Requirement: ShadowRoot-aware core mounting

Core editor configuration SHALL support an optional DOM root for hosts that mount an editor outside the global document root.

#### Scenario: ShadowRoot is supplied
- **WHEN** `createEditor` receives a container in a ShadowRoot and that ShadowRoot as its configuration root
- **THEN** CodeMirror SHALL mount and handle editor input inside that ShadowRoot
