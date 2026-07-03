# Change: Update plugin architecture with lifecycle, runtime management, and diagnostics

## Why

The existing plugin model in `@floatboat/nexus-core` was primarily static: plugins were aggregated at editor creation time, with limited runtime control and no structured dependency/runtime diagnostics. This made it difficult to:

- manage plugin lifecycle cleanly (setup/teardown ownership),
- enable/disable/reload plugins at runtime for host apps,
- coordinate plugins with deterministic dependency ordering, and
- debug plugin conflicts and runtime failures in a host-safe way.

To support roadmap plugin-system goals (event bus + hot-reload direction), the core plugin architecture needs an explicit lifecycle contract and runtime management APIs while preserving backward compatibility for existing plugins.

## What Changes

- Add plugin lifecycle setup context and teardown management in core.
- Add plugin dependency ordering via `dependsOn` with diagnostics for missing/cyclic dependencies.
- Add command/event bus APIs and structured plugin diagnostics APIs.
- Add runtime plugin management APIs:
  - `getActivePlugins()`
  - `usePlugin(plugin)`
  - `unusePlugin(name)`
  - `reloadPlugin(name, nextPlugin?)`
- Add scoped setup facades in plugin context:
  - `commandBus`
  - `eventBus`
  - `diagnostics`
- Keep existing static plugin fields fully compatible (`shortcuts`, `commands`, `handlers`, `remarkPlugins`, `cmExtensions`, `widgets`).
- Add/expand regression tests in `core` and `plugin-wordcount` for lifecycle and runtime plugin flows.

## Impact

- Affected specs:
  - `plugins` (new requirements for lifecycle/runtime management and diagnostics)
- Affected code:
  - `packages/core/src/types.ts`
  - `packages/core/src/editor.ts`
  - `packages/core/src/index.ts`
  - `packages/core/test/editor.test.ts`
  - `packages/plugin-wordcount/src/plugin.ts`
  - `packages/plugin-wordcount/test/plugin.test.ts`
  - `apps/electron-demo/src/renderer/editor-shell.ts`
  - `README.md`, `README.zh.md`, `packages/core/README.md`, `packages/plugin-wordcount/README.md`
