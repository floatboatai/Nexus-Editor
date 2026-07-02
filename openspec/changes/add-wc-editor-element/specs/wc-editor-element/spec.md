# WC Editor Element Spec — `<nexus-editor>` custom element

## ADDED Requirements

### Requirement: Explicit, Side-Effect-Free Registration

The package SHALL export `defineNexusEditor(tagName?: string): void`
and the `NexusEditorElement` class. Importing the package SHALL NOT
register anything with `customElements`. `defineNexusEditor` SHALL
default the tag name to `"nexus-editor"`, SHALL be a no-op when the
tag is already registered as `NexusEditorElement`, and SHALL throw
when the tag is registered to a different constructor.

#### Scenario: Import has no side effects
- **WHEN** the module is imported and `defineNexusEditor` is never
  called
- **THEN** `customElements.get("nexus-editor")` SHALL be `undefined`

#### Scenario: Double registration is a no-op
- **WHEN** `defineNexusEditor()` is invoked twice
- **THEN** the second call SHALL NOT throw

#### Scenario: Foreign constructor collision throws
- **WHEN** `"nexus-editor"` is already defined as another element
  class and `defineNexusEditor()` is invoked
- **THEN** the call SHALL throw

### Requirement: Editor Lifecycle Bound to Document Connection

A connected `<nexus-editor>` SHALL create one core editor via
`createEditor` with the element itself as `container`, and SHALL emit
`nexus-ready` (detail: `{ editor: EditorAPI }`). Removing the element
from the document SHALL destroy the editor. Moving the element within
the document in a single task (reparenting) SHALL NOT destroy the
editor. Re-inserting a previously removed element SHALL create a fresh
editor seeded with the document text captured at destroy time.

#### Scenario: Connection mounts an editor
- **WHEN** a `<nexus-editor value="# Hi">` element is appended to the
  document
- **THEN** the element SHALL contain a `.cm-editor` DOM subtree
- **AND** `nexus-ready` SHALL have fired with a usable `EditorAPI`

#### Scenario: Removal destroys the editor
- **WHEN** a connected element is removed and pending microtasks flush
- **THEN** `element.editor` SHALL be `null`
- **AND** the `.cm-editor` subtree SHALL be gone

#### Scenario: Reparenting preserves the editor
- **WHEN** a connected element is moved to another parent via
  `appendChild` in the same task
- **THEN** the same `EditorAPI` instance SHALL remain live and its
  document SHALL be unchanged

#### Scenario: Re-insertion restores the document
- **WHEN** an element whose document was `"draft"` is removed,
  microtasks flush, and the element is appended again
- **THEN** a new editor SHALL exist whose document is `"draft"`

### Requirement: Scalar Config via Attributes, Rich Config via Properties

The element SHALL read `value`, `readonly`, `direction`, `tab-size`,
`indent-guides`, `parse-delay-ms`, `slash-menu-limit`, `live-preview`
and `multi-cursor` attributes into the corresponding `EditorConfig`
fields at creation time. Boolean attributes SHALL follow the HTML
presence convention. The element SHALL expose `plugins`, `parser`,
`theme`, `locale`, `livePreview` and `onAssetUpload` as JavaScript
properties. When a property and an attribute both configure the same
option, the property SHALL win.

#### Scenario: Attributes reach the editor
- **WHEN** `<nexus-editor value="# Hi" readonly tab-size="2">` is
  connected
- **THEN** the mounted editor's document SHALL be `"# Hi"`
- **AND** the editor SHALL reject user edits (readOnly)

#### Scenario: Plugins arrive as a property
- **WHEN** `element.plugins = [somePlugin]` is set before connection
- **THEN** the mounted editor SHALL expose that plugin's slash
  commands via `getSlashCommands()`

#### Scenario: Property overrides attribute
- **WHEN** `live-preview` attribute is present and
  `element.livePreview = false` was set
- **THEN** the editor SHALL be created with live preview disabled

### Requirement: Controlled Document Semantics for `value`

The `value` property getter SHALL return the current editor document.
Setting the `value` property or attribute on a mounted element SHALL
apply the new text via silent `setDocument` when it differs from the
last synced document, and SHALL NOT emit `nexus-change` for that
update. User edits SHALL emit `nexus-change` (detail:
`{ markdown: string; ast: Root }`) and update the value returned by
the getter without reflecting to the attribute.

#### Scenario: External value update is silent
- **WHEN** a mounted element's `value` property is set to new text
- **THEN** `element.editor.getDocument()` SHALL return the new text
- **AND** no `nexus-change` event SHALL fire for that update

#### Scenario: User edits emit change
- **WHEN** the document changes through the editor (non-silent)
- **THEN** a `nexus-change` event SHALL fire whose
  `detail.markdown` equals the new document

#### Scenario: Value attribute does not echo
- **WHEN** the `value` attribute is set to the text the editor already
  contains
- **THEN** no `setDocument` round-trip SHALL occur

### Requirement: Post-Mount Config Changes Rebuild the Editor

The element SHALL apply post-mount changes to every observed attribute
other than `value` by rebuilding the editor with the updated config in
a microtask. Multiple changes in one task SHALL coalesce into a single
rebuild. The rebuild SHALL preserve the current document and selection,
and SHALL emit `nexus-ready` again with the new `EditorAPI` instance.

#### Scenario: readonly becomes effective after mount
- **WHEN** `setAttribute("readonly", "")` is called on a mounted
  editable element and microtasks flush
- **THEN** the rebuilt editor SHALL reject user edits
- **AND** its document SHALL equal the pre-rebuild document

#### Scenario: Multiple attribute writes coalesce
- **WHEN** `tab-size`, `direction` and `indent-guides` are all set in
  the same task
- **THEN** exactly one additional `nexus-ready` SHALL fire

### Requirement: Composed Custom Events

`nexus-ready`, `nexus-change`, `nexus-focus` and `nexus-blur` SHALL be
dispatched as `CustomEvent`s with `bubbles: true` and
`composed: true`.

#### Scenario: Events are delegable
- **WHEN** a `nexus-change` listener is attached to an ancestor of the
  element and the document changes
- **THEN** the listener SHALL receive the event
