## 1. React SDK

- [x] 1.1 Add `onReady` to `UseEditorConfig` in `types.ts`
- [x] 1.2 Add `EditorProps` interface (`className`, `style`) in `types.ts`
- [x] 1.3 Call `onReady` after editor creation in `use-editor.ts`
- [x] 1.4 Wrap `<Editor />` with `forwardRef` + `useImperativeHandle` in `editor.tsx`
- [x] 1.5 Export `EditorProps` from `index.ts`
- [x] 1.6 Add vitest unit tests for `onReady` callback and ref forwarding

## 2. Vue SDK

- [x] 2.1 Add `onReady` to `UseEditorConfig` in `types.ts`
- [x] 2.2 Call `onReady` after editor creation in `use-editor.ts`
- [x] 2.3 Emit `ready` event and call `expose({ editor })` in `editor.ts`
- [x] 2.4 Add `className` prop in `editor.ts`
- [x] 2.5 Add vitest unit tests for `ready` event and expose

## 3. Documentation

- [x] 3.1 Update `packages/react/README.md` with new API
- [x] 3.2 Update `packages/vue/README.md` with new API
