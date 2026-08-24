## 1. Implementation

- [ ] 1.1 Add `SmartPasteOptions` type and `smartPaste` field to `EditorConfig` in `packages/core/src/types.ts`
- [ ] 1.2 Implement `htmlTableToGfm(html): string | null` pure converter (alignment, pipe escaping, `<br>` flattening, inline formatting, ragged-row tolerance) in `packages/core/src/smart-paste/html-table-to-gfm.ts`
- [ ] 1.3 Implement `applyUrlLinkify(pastedText, selectedText): string | null` rule engine in `packages/core/src/smart-paste/url-linkify.ts`
- [ ] 1.4 Implement `createSmartPasteExtension` (paste/copy/cut `domEventHandlers`) in `packages/core/src/smart-paste/index.ts`; wire into `editor.ts` behind the resolved config, after plugin hooks and the file-upload pipeline
- [ ] 1.5 Enable `smartPaste: true` in the electron-demo editor shell
- [ ] 1.6 Update `packages/core/README.md`, root `README.md` features list, and register the ROADMAP row (en + zh)

## 2. Testing

- [ ] 2.1 Converter unit tests: basic table, alignment, pipe escaping, `<br>`, inline formatting, empty cells, ragged rows, non-table / broken HTML → null
- [ ] 2.2 Linkify rule tests: all six rules including multi-line selection and in-link-selection bail-outs
- [ ] 2.3 jsdom integration tests: real `ClipboardEvent` dispatch against a mounted editor with `smartPaste` enabled; plain-text and file paste paths unaffected when disabled
- [ ] 2.4 Atomicity test: one `undo()` reverts a smart paste completely
- [ ] 2.5 `pnpm build` + `pnpm test` green; manual three-scenario check in electron-demo

## 3. Documentation

- [ ] 3.1 OpenSpec change `add-smart-paste` (this proposal) validated with `openspec validate add-smart-paste --strict`
- [ ] 3.2 PR description references #197 and explains the complement/difference
