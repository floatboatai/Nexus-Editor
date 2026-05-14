## ADDED Requirements

### Requirement: Vue Editor expose for template refs

The `<Editor />` component SHALL call `expose({ editor })` so that a Vue template
ref gives access to the `EditorAPI` instance via `ref.value.editor.value`.

#### Scenario: Template ref exposes editor after mount
- **WHEN** a consumer uses `<Editor ref="editorRef" />`
- **THEN** `editorRef.value.editor.value` SHALL be the `EditorAPI` instance
  after the component is mounted

### Requirement: Vue Editor ready event

The `<Editor />` component SHALL emit a `ready` event carrying the `EditorAPI`
instance once, immediately after the editor is created in `onMounted`.

#### Scenario: ready event fires with EditorAPI
- **WHEN** `<Editor @ready="handler" />` is rendered and the component mounts
- **THEN** `handler` SHALL be called exactly once with the `EditorAPI` instance

#### Scenario: ready not emitted before mount
- **WHEN** the component has not yet mounted
- **THEN** the `ready` event SHALL NOT have been emitted

### Requirement: Vue Editor onReady callback in useEditor

`UseEditorConfig` SHALL accept an optional `onReady` callback invoked once after
the editor instance is created inside `onMounted`.

#### Scenario: onReady receives EditorAPI
- **WHEN** `onReady` is provided to `useEditor`
- **THEN** it SHALL be called exactly once with the `EditorAPI` instance on mount

### Requirement: Vue Editor className prop

The `<Editor />` component SHALL accept a `className` prop and apply it as the
`class` attribute on the container `<div>`.

#### Scenario: className applied to container
- **WHEN** `<Editor class-name="my-editor" />` is rendered
- **THEN** the container `<div>` SHALL have `class="my-editor"`
