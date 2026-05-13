## 1. OpenSpec

- [ ] 1.1 Review proposal with maintainers and choose the provider boundary.
- [ ] 1.2 Decide whether to depend on an existing CodeMirror/Yjs binding or implement a small adapter.
- [x] 1.3 Validate `add-realtime-collaboration` with OpenSpec CLI when available.

## 2. Package Scaffold

- [ ] 2.1 Add `packages/plugin-collab/package.json`, `tsconfig.json`, `src/index.ts`, and tests.
- [ ] 2.2 Add the package to root `pnpm build` and publish scripts.
- [ ] 2.3 Add README documentation for setup, lifecycle, and host-owned provider requirements.

## 3. Collaboration Core

- [ ] 3.1 Implement `createCollabPlugin(options)` with CodeMirror extensions for shared document sync.
- [ ] 3.2 Define and export `CollabProvider`, `CollabAwareness`, `CollabUser`, and `CollabPluginOptions`.
- [ ] 3.3 Ensure local edits are applied immediately and remote updates converge without duplicate local echoes.
- [ ] 3.4 Ensure `destroy()`/editor teardown disconnects listeners and provider resources.
- [ ] 3.5 Define behavior for switching `docId` and document reseeding.

## 4. Awareness / Presence

- [ ] 4.1 Track local user metadata and remote peer metadata.
- [ ] 4.2 Render remote selections/cursors as decorations.
- [ ] 4.3 Avoid stealing focus or changing the local selection when remote presence updates.

## 5. Demo Harness

- [ ] 5.1 Add an electron-demo smoke path with two editor instances or a local test provider.
- [ ] 5.2 Demonstrate concurrent typing convergence.
- [ ] 5.3 Demonstrate remote cursor/presence rendering.

## 6. Tests

- [ ] 6.1 Unit test provider lifecycle and cleanup.
- [ ] 6.2 Integration test two editor instances editing the same document.
- [ ] 6.3 Test offline/reconnect replay if the chosen provider supports it in-process.
- [ ] 6.4 Test collaboration with the history plugin enabled.
- [ ] 6.5 Test remote updates while live preview is enabled.

## 7. Documentation / Roadmap

- [ ] 7.1 Update `README.md` / `README.zh.md` package lists.
- [ ] 7.2 Update `docs/ROADMAP.md` / `docs/ROADMAP.zh.md` once implementation status changes.
- [ ] 7.3 Document non-goals and provider ownership clearly.
