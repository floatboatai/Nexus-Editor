## ADDED Requirements

### Requirement: React Editor ref forwarding

The `<Editor />` component SHALL forward a React ref typed as `EditorAPI` so
consumers can call imperative methods without a separate state variable.

#### Scenario: Ref holds EditorAPI after mount
- **WHEN** a consumer renders `<Editor ref={editorRef} />`
- **THEN** `editorRef.current` SHALL be the `EditorAPI` instance after the
  component mounts

#### Scenario: Ref is null before mount
- **WHEN** the component has not yet mounted
- **THEN** `editorRef.current` SHALL be `null`

### Requirement: React Editor onReady callback

`UseEditorConfig` SHALL accept an optional `onReady` callback that is invoked
once, synchronously after the editor instance is created and attached to the DOM.

#### Scenario: onReady receives EditorAPI
- **WHEN** `onReady` is provided and the component mounts
- **THEN** `onReady` SHALL be called exactly once with the `EditorAPI` instance

#### Scenario: onReady not required
- **WHEN** `onReady` is omitted
- **THEN** the component SHALL mount without error

### Requirement: React Editor container props

The `<Editor />` component SHALL accept `className` and `style` props and apply
them to the container `<div>` element.

#### Scenario: className applied to container
- **WHEN** `<Editor className="my-editor" />` is rendered
- **THEN** the container `<div>` SHALL have `class="my-editor"`

#### Scenario: style applied to container
- **WHEN** `<Editor style={{ height: 400 }} />` is rendered
- **THEN** the container `<div>` SHALL have the corresponding inline style
