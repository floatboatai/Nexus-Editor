# @floatboat/nexus-plugin-runtime

Host-neutral plugin lifecycle and registry runtime for
[Nexus-Editor](https://github.com/floatboatai/Nexus-Editor): component
lifecycles, capability authorization, and every owner-scoped registry the
editor exposes to plugins.

## Install

```bash
pnpm add @floatboat/nexus-plugin-runtime @floatboat/nexus-plugin-api
```

## Provided capabilities

Every capability below is served by an owner-bound `createService(owner,
registerResource)`; a host registers the provider, the runtime binds the
resulting resources to the owning plugin's lifecycle:

- `nexus.commands`, `nexus.hotkeys`, `nexus.scopes`
- `nexus.editor-host`, `nexus.editor-clipboard`, `nexus.editor-transactions`
- `nexus.markdown-processors`
- `nexus.workspace`, `nexus.vault`, `nexus.file-manager`, `nexus.metadata`
- `nexus.resources`, `nexus.ui`, `nexus.plugin-storage`

## Editor transactions

`nexus.editor-transactions` is scoped to **one** editor, so a host
constructs one `EditorTransactionPipeline` per attached editor — inside its
`attachEditor` — and disposes it when that editor detaches. Nothing in the
service resolves "the current editor":

```ts
const transactions = new EditorTransactionPipeline({
  context: () => attachment.context,
  reportDiagnostic,
});

const provider = capabilities.registerOwnerBound(
  EDITOR_TRANSACTIONS_CAPABILITY,
  ({ owner, registerResource }) => transactions.createService(owner, registerResource),
  { context: { editorId: PRIMARY_EDITOR_ID } },
);

// On detach:
await provider.revoke("editor-detached");
await transactions.dispose();
```

Registration returns a staged handle: the hook reaches the editor only when
the plugin's component activates it, and `dispose()` removes it again.

The provider has to be registered with `context: { editorId }` (exactly as
above): the capability is editor-scoped, and a provider registered without
that context is rejected by the registry.

## From a plugin

```ts
const transactions = this.app.capabilities.require(
  EDITOR_TRANSACTIONS_CAPABILITY,
  "^1.0.0",
  { editorId }, // the capability is editor-scoped: the context is required
);

transactions.registerFilter((context) => ({ action: "accept" })); // or reject / replace
transactions.registerUpdateListener((update) => console.log(update.documentAfter));

const result = transactions.dispatch(editorId, {
  changes: [{ from: 0, to: 0, insert: "x" }],
  selectionBefore: { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0 },
  selectionAfter: { ranges: [{ anchor: 1, head: 1 }], mainIndex: 0 },
  origin: ["my-plugin"],
  operationId: "my-plugin:entry-1",
});
// -> { ok: true, value: { operationId: "my-plugin:entry-1" } }
```

A caller-supplied `operationId` is echoed back verbatim; without one the
service generates `editor-operation:<n>`. Commits the user types carry no
`operationId` (there is no caller), which is reported as `undefined` rather
than a synthesised identity.

## Boundaries

- Dispatching from inside a **filter** is refused deterministically; the
  outer commit still completes. This guard covers calls that go through this
  service only: a plugin that calls `context.editor.dispatchTransaction`
  directly (or commits through `replaceRange` / `setDocument` /
  `replaceSelection` / `undo` / `redo` inside a filter) is using the raw
  editor API, which is outside this guarantee. It is a deterministic
  contract, **不是安全机制** (not a security boundary).
- A faulty filter (throwing, returning a promise, returning a malformed
  result) is reported and bypassed — never treated as a veto. Only an
  explicit `reject` cancels a transaction.
- `annotations` are passed through by reference. The runtime does not merge,
  rewrite, or namespace their keys; that is the caller's responsibility.

## Documentation

- [Native plugin API guide](../../docs/plugins/native-plugin-api.zh.md)
- [Plugin platform proposal](https://github.com/floatboatai/Nexus-Editor/tree/main/openspec/changes/archive/2026-08-13-add-plugin-platform-api)
