# Change: Extend React and Vue SDK with onReady callback, ref forwarding, and container props

## Why
The React `<Editor />` and Vue `<Editor />` components expose no way for consumers
to obtain the `EditorAPI` instance imperatively, receive a mount notification, or
apply CSS class / style to the container element. This blocks real-world integration
patterns (save buttons, programmatic focus, layout control) and is listed as P0 in
the roadmap (item #4).

## What Changes
- `packages/react`: add `onReady` callback to `UseEditorConfig`; wrap `<Editor />`
  with `forwardRef<EditorAPI>` + `useImperativeHandle` so consumers can hold a ref;
  pass `className` and `style` through to the container `<div>`; export new
  `EditorProps` type.
- `packages/vue`: add `onReady` callback to `UseEditorConfig`; emit `ready` event
  from `<Editor />`; call `expose({ editor })` so template refs work; add
  `className` prop.
- Both packages: add vitest unit tests covering `onReady` timing and ref access.

## Impact
- Affected specs: react-sdk (new), vue-sdk (new)
- Affected code: `packages/react/src/`, `packages/vue/src/`
- No breaking changes — all additions are opt-in; existing usage compiles unchanged.
