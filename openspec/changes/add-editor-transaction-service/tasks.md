## 1. Runtime mechanism (packages/plugin-runtime)

- [x] 1.1 Add `editor-transaction-adapters.ts` (context/transaction translation, three-state filter results, replacement validation, diagnostics) as an internal module
- [x] 1.2 Add `EditorTransactionPipeline` with staged registration, activate-on-lifecycle, dispose, and instance-level re-entrancy guard
- [x] 1.3 Export exactly the two new public names from `src/index.ts`
- [x] 1.4 Regenerate `api/public-exports.json` (`check:api:update` → `(178 exports)`, net +2)
- [x] 1.5 Mechanism tests in `test/editor-transaction-service.test.ts` against a real core editor and a real `EditorHostRegistry` (T2–T19)

## 2. Host wiring (apps/electron-demo)

- [x] 2.1 Construct one pipeline per attached editor and register the `nexus.editor-transactions` provider with `{ context: { editorId } }`
- [x] 2.2 Release the provider and dispose the pipeline on detach and on attach failure
- [x] 2.3 Assembly-level test: plugin declaring the capability loads, its filter rewrites a real edit, detach removes the provider (T1)

## 3. Documentation and compliance

- [x] 3.1 Add `packages/plugin-runtime/README.md`
- [x] 3.2 Add the "事务过滤与更新监听" section to `docs/plugins/native-plugin-api.zh.md`
- [x] 3.3 OpenSpec change `add-editor-transaction-service` (this directory)

## Evidence

Pre-wiring red for 2.3, captured verbatim before the host wiring landed:

```json
{"ok":false,"state":"incompatible","diagnostics":[{"code":"capability-unsupported","severity":"error","phase":"validation","message":"Capability nexus.editor-transactions is not provided in this context.","plugin":{"id":"electron-host-fixture","version":"1.0.0"},"capability":{"id":"nexus.editor-transactions","requestedVersion":"^1.0.0"}}]}
```

### Smoke test (`smoke:multi-window`)

The runner cannot execute on Windows: `scripts/electron-multi-window-smoke-run.mjs` spawns a
bare `pnpm` without a shell (`ENOENT` — libuv only resolves `.exe`/`.com`, and pnpm ships as
`pnpm.cmd`), so it fails while bundling, before Electron starts. This is pre-existing and
unrelated to this change; CI runs the step on `ubuntu-latest` (`ci.yml:65-66`) where it applies.

To keep the gate's actual coverage, its four steps were replayed by hand on this machine
(same entry, same output paths, same `NEXUS_ELECTRON_SMOKE_TIMEOUT_MS`, repository Electron
binary) and the harness reported success:

```json
{"ok":true,"smoke":"electron-multi-window-window-context","electron":"35.7.5","platform":"win32","arch":"x64",
 "beforeClose":{"browserWindowCount":3,"distinctWebContents":true,"distinctPrimarySession":true,"popupSharesOpenerSession":true},
 "afterAllClosed":{"browserWindowCount":0},"cleanup":{"unloadState":"unloaded","unloadClean":true}}
```

This is an equivalent execution, not the official runner. The official command is expected to
pass in CI.

The openspec CLI is not vendored in this repository either; the change is validated with the
mechanical checks listed in the pull request instead.
