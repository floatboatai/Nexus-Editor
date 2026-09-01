## 1. Core root support

- [ ] 1.1 Add failing core tests for mounting in a supplied ShadowRoot and retaining existing document-root behavior.
- [ ] 1.2 Add optional `EditorConfig.root` and forward it to CodeMirror `EditorView`.
- [ ] 1.3 Run targeted core tests and `pnpm typecheck`.

## 2. Web Component package

- [ ] 2.1 Add `packages/wc` package metadata, TypeScript configuration, and public exports.
- [ ] 2.2 Add failing lifecycle tests for connect, disconnect, reconnect, controlled external value, user change, and duplicate registration.
- [ ] 2.3 Implement `NexusEditorElement` and `defineNexusEditorElement` with an open ShadowRoot.
- [ ] 2.4 Build the package and run its tests.

## 3. Browser integration and documentation

- [ ] 3.1 Extend the browser interaction fixture with a Web Component page and ShadowRoot assertions.
- [ ] 3.2 Add `packages/wc/README.md` and package entries in both root READMEs.
- [ ] 3.3 Run `pnpm test`, `pnpm typecheck`, `pnpm check:api`, `pnpm build`, `pnpm build:electron-demo`, and `pnpm test:e2e`.

## 4. Review gate

- [ ] 4.1 Obtain maintainer approval for this OpenSpec change before beginning implementation.
