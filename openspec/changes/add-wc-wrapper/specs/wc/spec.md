# WC Spec

## ADDED Requirements

### Requirement: register a `<nexus-editor>` custom element
`defineNexusEditor(tagName?)` SHALL register the `NexusEditorElement` class as a custom element under the given tag name, defaulting to `nexus-editor`. Calling it more than once with the same tag name SHALL NOT throw.

#### Scenario: default registration
- **WHEN** `defineNexusEditor()` is called
- **THEN** `customElements.get("nexus-editor")` SHALL return the `NexusEditorElement` class

#### Scenario: custom tag name
- **WHEN** `defineNexusEditor("my-editor")` is called
- **THEN** `customElements.get("my-editor")` SHALL return the `NexusEditorElement` class

#### Scenario: idempotent registration
- **WHEN** `defineNexusEditor()` is called twice
- **THEN** the second call SHALL NOT throw

#### Scenario: foreign tag collision
- **WHEN** the requested tag name is already registered to a different constructor
- **THEN** `defineNexusEditor(tagName)` SHALL throw instead of silently reporting success

### Requirement: mount a core editor instance on connect
On `connectedCallback`, the element SHALL create a single light-DOM `<div>` child and construct a `createEditor` instance from `@floatboat/nexus-core` using that div as `container`. On a permanent disconnect, the element SHALL call `editor.destroy()` and remove the internal container after the current microtask. A synchronous disconnect/reconnect caused by DOM reparenting SHALL preserve the live instance.

#### Scenario: editor is available after connecting
- **WHEN** a `<nexus-editor>` element is appended to the document
- **THEN** `element.editor` SHALL be a non-null `EditorAPI` after the `nexus-ready` event fires

#### Scenario: editor is destroyed on disconnect
- **WHEN** a connected `<nexus-editor>` element is removed from the document
- **THEN** after the current microtask the underlying `EditorAPI.destroy()` SHALL have been called and `element.editor` SHALL be `null`

#### Scenario: synchronous reparent preserves uncontrolled edits
- **WHEN** an uncontrolled element is moved synchronously between connected parents
- **THEN** its live `EditorAPI` and current document SHALL be preserved

### Requirement: controlled and uncontrolled document value
The `initial-value` attribute SHALL seed the document once at connect time (uncontrolled mode). The `value` attribute/property SHALL put the element in controlled mode: external changes SHALL be applied via `setDocument(value, { silent: true })`, and user edits SHALL be reported via the `nexus-change` event without re-applying the value that produced them.

#### Scenario: uncontrolled initial value
- **WHEN** `<nexus-editor initial-value="# Hello"></nexus-editor>` connects
- **THEN** `element.editor.getDocument()` SHALL return `"# Hello"`

#### Scenario: controlled value updates the document silently
- **WHEN** `element.value = "next"` is set after the element is connected
- **THEN** `element.editor.getDocument()` SHALL return `"next"`
- **AND** no `nexus-change` event SHALL fire for that programmatic update

#### Scenario: skip redundant sync when value matches last emitted change
- **WHEN** `element.value` is set to the same string most recently emitted via `nexus-change`
- **THEN** the element SHALL NOT call `setDocument` again for that value

#### Scenario: newer controlled value supersedes delayed change
- **WHEN** an older user change is waiting for `parse-delay-ms` and the host applies a newer controlled value
- **THEN** the older delayed change SHALL NOT be emitted after the newer value is applied

### Requirement: forward editor lifecycle and interaction events
The element SHALL dispatch `CustomEvent`s named `nexus-ready`, `nexus-change`, `nexus-focus`, `nexus-blur`, `nexus-selectionchange`, and `nexus-slashmenuchange`, each `bubbles: true`, `composed: true`, and carrying the corresponding core payload in `event.detail`.

#### Scenario: nexus-ready carries the editor instance
- **WHEN** the element connects and finishes creating the editor
- **THEN** a `nexus-ready` event SHALL fire with `event.detail.editor` equal to `element.editor`

#### Scenario: nexus-change carries doc and ast
- **WHEN** the user edits the document
- **THEN** a `nexus-change` event SHALL fire with `event.detail.doc` (string) and `event.detail.ast` (mdast Root)

### Requirement: initial-only configuration parity with React/Vue bindings
Attributes and properties other than `value`/`initial-value` (`read-only`, `tab-size`, `direction`, `indent-guides`, `live-preview`, `multi-cursor`, `slash-menu-limit`, `parse-delay-ms`, `plugins`, `parser`, `theme`, `locale`, `onAssetUpload`) SHALL be read once when the editor is created and SHALL NOT trigger a live reconfiguration when changed after connection, matching `packages/react`'s `useEditor` mount-only creation effect. Properties assigned before custom-element registration SHALL be replayed through the upgraded element's setters before configuration is read.

#### Scenario: changing read-only after connect does not affect the live editor
- **WHEN** `element.readOnly` is set to `true` after the element has connected
- **THEN** the already-created `EditorAPI` instance's editability SHALL remain unchanged until the element is reconnected

#### Scenario: pre-upgrade property is preserved
- **WHEN** a host assigns `value` or another public property before `defineNexusEditor()` upgrades the element
- **THEN** the upgraded element SHALL initialize from that assigned property

#### Scenario: multi-cursor configuration is forwarded
- **WHEN** `multi-cursor` is present before connection
- **THEN** the created editor SHALL allow multiple selection ranges

### Requirement: publish TypeScript DOM integration
The package declaration surface SHALL register `nexus-editor` in `HTMLElementTagNameMap` and type all public `nexus-*` events.

#### Scenario: query the default element in TypeScript
- **WHEN** a TypeScript consumer calls `document.querySelector("nexus-editor")`
- **THEN** the result SHALL be typed as `NexusEditorElement | null`

### Requirement: connect a parent page to an iframe runtime
The `@floatboat/nexus-wc/iframe-parent` entry point SHALL export `connectNexusIframe(iframe, options)`. It SHALL require an exact non-wildcard `targetOrigin`, discover the runtime only from the supplied iframe window and origin, and transfer a dedicated `MessagePort` after a versioned handshake.

#### Scenario: origin-checked connection becomes ready
- **WHEN** the supplied iframe announces a compatible runtime from `targetOrigin`
- **THEN** `controller.ready` SHALL resolve after the dedicated port reports ready

#### Scenario: wildcard origin is rejected
- **WHEN** `targetOrigin` is `"*"`, opaque, or contains a path
- **THEN** `connectNexusIframe` SHALL throw before sending a message

#### Scenario: incompatible or unrelated messages are ignored
- **WHEN** a message has a different source window, origin, protocol name, or version
- **THEN** it SHALL NOT connect or control the iframe runtime

### Requirement: proxy the minimal iframe editor surface
`NexusIframeController` SHALL expose asynchronous `getDocument`, `setDocument`, and `focus` methods, an `onChange` subscription, and synchronous `destroy`. Programmatic `setDocument` SHALL be silent inside the runtime so controlled hosts do not receive their own value as a user change.

#### Scenario: document round trip
- **WHEN** the parent sets a document and then gets it
- **THEN** the returned document SHALL equal the value applied in the iframe
- **AND** the set operation SHALL NOT emit a change event

#### Scenario: user edit crosses the iframe boundary
- **WHEN** the editor inside the iframe reports a document change
- **THEN** every active parent `onChange` listener SHALL receive the new document string

#### Scenario: request times out
- **WHEN** a ready runtime does not answer a command within `timeoutMs`
- **THEN** that command promise SHALL reject with a stable `TIMEOUT` bridge error

#### Scenario: document replacement during IME composition
- **WHEN** the parent requests `setDocument` while the iframe editor is composing text
- **THEN** the request SHALL reject with `COMPOSING`
- **AND** the runtime SHALL NOT acknowledge or queue the replacement

### Requirement: mount an iframe runtime around the core editor
The `@floatboat/nexus-wc/iframe-runtime` entry point SHALL export `mountNexusIframeRuntime(options)`. It SHALL require execution inside an iframe and an exact `allowedParentOrigin`, create an `EditorAPI` from the locally supplied `editorConfig`, and accept a compatible connection only from `window.parent` at that origin.

#### Scenario: runtime configuration stays local
- **WHEN** the runtime mounts with plugins, parsers, themes, or callbacks in `editorConfig`
- **THEN** those values SHALL be passed directly to `createEditor` and SHALL NOT be serialized through window messaging

#### Scenario: runtime is destroyed remotely
- **WHEN** the parent controller sends destroy
- **THEN** the runtime SHALL remove its listeners, close its port, and destroy the core editor

### Requirement: invalidate a bridge across iframe reload
Every runtime mount SHALL have a unique runtime id. A controller connected to one runtime SHALL fail when the same iframe announces a different runtime id, and the host SHALL create a new controller for the replacement runtime.

#### Scenario: iframe reloads after connection
- **WHEN** a connected iframe loads and announces a different runtime id
- **THEN** pending and subsequent controller operations SHALL reject with `IFRAME_RELOADED`

#### Scenario: replacement page does not mount a runtime
- **WHEN** a connected iframe fires load but no compatible runtime answers within `timeoutMs`
- **THEN** the controller SHALL become terminal and subsequent operations SHALL reject with `IFRAME_RELOADED`
