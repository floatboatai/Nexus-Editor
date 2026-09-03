## 1. Submission and red-test baseline

- [x] 1.1 Create one `codex/feat-collab-realtime-editing` branch from clean `origin/main@af58999`; keep the OpenSpec change active and submit only one final PR.
- [x] 1.2 Exclude historical OpenSpec cleanup, `.pnpm-store/`, Electron smoke output, build artifacts, secrets, and personal data from the PR.
- [x] 1.3 Record the take-home single-PR/no-intermediate-approval constraint and planned AI disclosure in the PR description.
- [x] 1.4 Add failing Core tests for exclusive source registration, readiness, owner identity, disposal, Editor destruction, and competing-registration rollback.
- [x] 1.5 Add failing tests proving Local Proposal accept/reject/replace behavior remains unchanged.
- [x] 1.6 Add failing tests proving Authoritative Updates bypass every filter but update EditorState, AST, events, and listeners exactly once.
- [x] 1.7 Add failing tests for authoritative batch atomicity, selection mapping, recursion limit, listener isolation, and structured lifecycle failures.
- [x] 1.8 Add failing tests proving all Undo/Redo entry points use one active controller, never fall through while active, and restore defaults after disposal.
- [x] 1.9 Add failing table/Widget tests for Markdown-source fallback, pointer-gesture cancellation, IME, click-to-edit, range selection, grips, outside deselection, and delete paths.

## 2. Core authoritative source

- [x] 2.1 Add and explicitly export authority, history controller, registration, context, and structured result types.
- [x] 2.2 Implement exclusive owner-scoped source registration and idempotent readiness/disposal cleanup.
- [x] 2.3 Split transaction preparation into Local Proposal and Authoritative Update paths without duplicating commit/notification logic.
- [x] 2.4 Attach authority and source-owner provenance to committed update contexts and diagnostics.
- [x] 2.5 Preserve atomic batch, recursion, AST, event, listener, and destroyed-Editor behavior on both paths.
- [x] 2.6 Route EditorAPI, keymap, browser beforeinput, and Host history commands through the active source controller; allow CodeMirror fallback only when no source exists.
- [x] 2.7 Activate internal external-document mode as part of source readiness and remove it during disposal.
- [x] 2.8 Implement live-preview table Markdown-source fallback and cancel active non-text Widget gestures before Authoritative Updates.
- [x] 2.9 Exercise every Table Widget Development Rule in `AGENTS.md` with automated coverage; attempt the Electron walkthrough and record the manual result as `SKIP` when the Linux accessibility provider exposes neither WebView nodes nor screenshots.

## 3. Collaboration package and schema

- [x] 3.1 Scaffold browser-safe `@floatboat/nexus-plugin-collab` with strict ESM exports and no framework, Electron, Node filesystem, or server SDK dependency in its default entry.
- [x] 3.2 Add `yjs@13.6.32` as peer plus development dependency and `y-protocols@1.0.7` as direct dependency; verify the lockfile contains no Yjs 14 `@y/*` mix.
- [x] 3.3 Add branded `DocumentId`, `CollabDocumentRef`, option, handle, snapshot, diagnostic, and error types without exposing raw Yjs objects.
- [x] 3.4 Implement schema creation/validation for `Y.Text("content")` and `Y.Map("nexus:meta")` with schema version, DocumentId check, and creation marker.
- [x] 3.5 Implement explicit `create` as the sole seeding path and `open` as join-only; reject duplicate creation and identity/schema mismatch.
- [x] 3.6 Add deterministic unit/property tests for duplicate, delayed, reordered, and partitioned Yjs updates, Unicode/CJK/emoji, and saved replay seeds.

## 4. Engine, Registry, Provider, and Store

- [x] 4.1 Implement the small `CollaborationEngine` interface and idempotent Engine close.
- [x] 4.2 Implement a DocumentRegistry that deduplicates concurrent opens, reference-counts independent handles, rejects stale handles, and isolates per-document failure.
- [x] 4.3 Implement Replica restore → schema validation → observation → Provider start → readiness ordering.
- [x] 4.4 Implement Nexus ProviderFactory/ProviderLease contracts with separate transport and initial-sync state and idempotent release.
- [x] 4.5 Implement ReplicaStore/lease contracts with load, append, flush, snapshot hooks, explicit corruption/failure results, and no false durability state.
- [x] 4.6 Add deterministic in-memory Provider and Store contract adapters under testkit/assessment exports, not the ordinary production entry.
- [x] 4.7 Require explicit `{ mode: "volatile" }` when durability is absent and expose `persistence="volatile"` rather than `clean`/`persisted`.
- [x] 4.8 Add lifecycle, offline/reconnect simulation, duplicate update, initial-sync interruption, store failure, and resource-baseline tests.

## 5. Editor Binding and history

- [x] 5.1 Implement `document.attach(editor, { content })` with one readiness gate and atomic `replace-editor`/`require-match` semantics.
- [x] 5.2 Project only accepted Local Proposals into Y.Text with one unique local origin per Binding.
- [x] 5.3 Project non-local Y.Text deltas through the Core authoritative registration and prevent feedback loops.
- [x] 5.4 Give each Binding a Y.UndoManager that tracks only its origin and wire it into the mandatory Core history controller.
- [x] 5.5 Compare Editor and Y.Text after commits; quarantine and stop Local Proposals on mismatch without rewriting Y.Text.
- [x] 5.6 Make Binding detach idempotent and prove one Replica can serve multiple independent Editors without cross-destroying resources.
- [x] 5.7 Cover local/remote concurrent insert/delete/replace, per-Binding Undo/Redo, selection mapping, IME, attach races, detach races, and recovery failures.

## 6. Presence and thin integrations

- [x] 6.1 Implement ephemeral Presence on Awareness with Host identity input, relative selections, throttling/coalescing, and bounded payloads; the Engine does not treat Presence as authentication.
- [x] 6.2 Sanitize remote name/color/avatar fields and prove malicious HTML/CSS/URL payloads never enter unsafe DOM sinks.
- [x] 6.3 Implement blur, document switch, detach, disconnect, protocol expiry, and Engine-close cleanup without coupling document convergence to Presence; production disconnect/authorization expiry remains Q4/Q7 qualification.
- [x] 6.4 Document and contract-test the same Engine attach path for direct Core, React `onReady`, and Vue readiness/mounted use.
- [x] 6.5 Do not add a speculative native adapter; document direct orchestration through the public `EditorHostService` lifecycle.
- [x] 6.6 Add Electron demo integration using the assessment adapter, visibly labelled local/experimental with no durability or authorization claim.
- [x] 6.7 Verify framework unmount, plugin unload, context switch, Editor destroy, document close, and Engine close return observers, timers, rAF callbacks, Provider leases, and Presence state to baseline through the collaboration and existing Host lifecycle suites.

## 7. Documentation, evidence, and final PR

- [x] 7.1 Document public Engine/source interfaces, ordering, errors, ownership, support level, demo limits, and create/open examples in package READMEs.
- [x] 7.2 Update public API snapshots and consumer fixtures for every new export.
- [x] 7.3 Record dependency name, exact version, MIT license, rationale, and replacement cost for the final PR.
- [x] 7.4 Record benchmark baselines for idle Engine, local typing, authoritative dispatch, multi-Editor remote churn, and large Markdown updates without inventing unsupported budgets.
- [x] 7.5 Run package tests, repository `pnpm typecheck`, `pnpm check:api`, `pnpm test`, `pnpm build`, and `pnpm build:electron-demo` (Node 26 test run disables its experimental Web Storage accessor so Vitest uses jsdom storage; see qualification record).
- [x] 7.6 Run Electron multi-window smoke; attempt the table walkthrough with and without an authoritative source, retaining the automated interaction suite and recording the manual Linux computer-use limitation as `SKIP` rather than `PASS`.
- [x] 7.7 Run fixed-version `openspec validate add-plugin-collab --strict --no-interactive` and full `validate --all`.
- [x] 7.8 Inspect the final diff for generated files, unrelated changes, misleading production claims, secrets, and undisclosed AI assistance.
- [ ] 7.9 Submit the user-authorized final PR from `feat/collab-product-completion` with per-package changes, commands, scenarios, limitations, OpenSpec id, Roadmap #18, dependency review, and honest AI disclosure. This pre-publication checkbox is fulfilled by opening the final PR; the previous closed PR is not the final submission.
- [x] 7.10 Leave `add-plugin-collab` active; maintainers decide approval, merge, and later archive.

## 8. Real authenticated Provider and reference server

- [x] 8.1 Add red contract and loopback integration tests for independent WebSocket clients, initial sync, concurrent edits, Awareness, duplicate delivery, reconnect, and resource cleanup.
- [x] 8.2 Add red authorization tests for signed expiring credentials, DocumentId scope, read-only participants, invalid signature, expiry, revocation, bounded credentials, and secret-free diagnostics.
- [x] 8.3 Implement a real Provider adapter behind `CollaborationProviderFactory` without exposing vendor/Yjs objects from the ordinary Engine interface.
- [x] 8.4 Extend Provider and document state so authenticating, read-only, read-write, denied, and expired are distinct from transport and sync.
- [x] 8.5 Reject a non-writable Binding's Local Proposals before Yjs while continuing to accept authorized remote updates.
- [x] 8.6 Add a runnable reference collaboration server with health/readiness, bounded messages, deterministic shutdown, and per-document isolation.
- [x] 8.7 Implement atomic server-side Yjs state persistence and verify acknowledged state survives restart while corrupt state fails closed.
- [x] 8.8 Document server configuration, token issuance, TLS termination assumptions, storage location, backup boundary, and operational limitations.
- [x] 8.9 Bound authenticated and pre-authentication pending message count/bytes at ingress, cap exact whole-document validation work, and qualify burst isolation from unrelated rooms and health probes.
- [x] 8.10 Linearize runtime credential revocation with all authenticated messages, and prove revoke-first writer rejection, update-first completion, read-only SyncStep1 non-disclosure, failure-release, same-room recovery, Presence cleanup, and unrelated-room cases without timing-dependent tests.

## 9. Durable local Replica Stores and Electron broker

- [x] 9.1 Add browser IndexedDB contract tests for document isolation, ordered append, reload recovery, flush, compaction, corruption, blocked/unavailable storage, and idempotent close.
- [x] 9.2 Implement the IndexedDB Replica Store using native browser APIs and export it through a browser-safe explicit entry.
- [x] 9.3 Prove offline browser edits survive Engine destruction/recreation and converge once the real Provider reconnects.
- [x] 9.4 Add SQLite journal tests for transactional append, replay order, operation idempotency, snapshot compaction, corruption, concurrent callers, and crash-boundary recovery.
- [x] 9.5 Implement the Electron collaboration persistence worker using built-in `node:sqlite`, with a Node >=22.5 capability gate and no native addon.
- [x] 9.6 Implement one main-process broker and renderer message-port Store adapter; no renderer may receive database paths or execute SQL.
- [x] 9.7 Handle worker exit, request timeout, reconnect/replay, graceful flush, and application shutdown without reporting false durability.
- [ ] 9.8 Add packaged-app capability and two-renderer single-writer smoke coverage on supported Electron targets.
- [x] 9.9 Drain preload per-lease tails and renderer-to-worker MessagePort transit before broker shutdown, and reject zero-code worker exit without an explicit durable-cleanup acknowledgement.

## 10. Markdown File Projection and reconciliation

- [x] 10.1 Add red tests for durable File Identity ↔ DocumentId enrollment and rename/move without room identity change.
- [x] 10.2 Define small Host-supplied file and collaborative Markdown ports; keep filesystem paths and Node types out of the default Engine interface.
- [x] 10.3 Implement atomic CRDT-to-file projection with optimistic version checks and durable Projection Base metadata.
- [x] 10.4 Add operation identity and content/version checks that suppress only confirmed self-write watcher echoes.
- [x] 10.5 Implement deterministic three-way reconciliation for one-sided and non-overlapping changes, including Unicode and line-ending normalization.
- [x] 10.6 Enter explicit File Conflict for overlapping, base-less, stale-version, and ambiguous changes without overwriting either side.
- [x] 10.7 Implement generation-checked keep-live, accept-disk, and manual-merge resolution followed by a new atomic Projection Base.
- [x] 10.8 Cover file rename, delete, permission failure, external editor writes, watcher reordering, restart recovery, and projection cleanup.

## 11. Host Collaboration Workspace and product workflow

- [x] 11.1 Add red state-machine tests for create, join, attach, leave, retry, read-only, offline, persistence warning, conflict, and close.
- [x] 11.2 Implement one Host-owned Collaboration Workspace that orchestrates Engine, identity enrollment, Store, Provider, and File Projection without duplicating their state machines.
- [x] 11.3 Add Electron create/join/leave UI with server configuration, invitation input, participant/access state, reconnect action, and explicit content-mismatch choice.
- [x] 11.4 Keep credentials in the privileged Host or an in-memory capability; never persist them in Markdown, URLs, logs, renderer storage, or plugin-visible context.
- [x] 11.5 Replace the assessment lab as the primary product entry with distinct renderer processes using the real Provider and Electron Store; make the runtime Host the default, retain `NEXUS_PLUGIN_PLATFORM=0` only as an explicit legacy compatibility path, and keep the lab only as a developer tool.
- [x] 11.6 Add actionable UI for authentication, network, local persistence, server persistence, Quarantine, and File Conflict failures.
- [x] 11.7 Verify leave preserves the local Markdown file, removes Presence, closes leases, and does not implicitly delete the remote document.
- [x] 11.8 Fence cross-window rename/forget/abandon with exact-record tombstones and fence file/directory delete with durable path reservations plus explicit crash recovery.
- [x] 11.9 Pair durable delete reservations with a same-Vault Host mutation barrier, exact-operation trash permits, bounded projection-write permits, startup fence rehydration, and durable stale-projection identity checks.
- [x] 11.10 Fence concurrent invitation joins for one local path across renderer sessions until exact Enrollment commit, including crash cleanup and retryable Host release.
- [x] 11.11 Persist version-4 exact pending joins before Projection, retain inactive Host fences across renderer loss, rebuild them after Host restart, and recover every write/Base/Enrollment/release boundary without inferring that missing evidence means no file write.
- [x] 11.12 Expose pending-join status, safe recovery, same-invitation retry, and evidence-constrained abandon in the Collaboration panel; block overlapping rename/delete and prohibit abandon whenever Projection metadata exists.

## 12. Product qualification and local handoff

- [x] 12.1 Pass end-to-end tests with two independent clients and two Electron renderer processes through the real server (Linux built application; packaged cross-platform qualification remains separate).
- [x] 12.2 Pass offline edit → client restart → reconnect, server restart, authorization expiry/revocation, renderer crash, and external-file conflict scenarios (actual Linux renderer termination after confirmed local durability, not utility/transaction-fault-point crash qualification).
- [x] 12.3 Add protocol fuzz/bounds checks, credential redaction checks, database corruption recovery, and cross-document isolation tests.
- [ ] 12.4 Record browser trace, idle/update memory baseline, large document/update latency, backpressure behavior, and an eight-hour soak or an explicit bounded substitute.
- [x] 12.5 Update API snapshots, dependency/license/replacement-cost review, README, server operations guide, product design, qualification matrix, and Roadmap status to match evidence.
- [x] 12.6 Run package and integration suites, full typecheck/API/test/build, Electron build/multi-window smoke, sandboxed-preload startup smoke against the built secure-origin renderer in default-runtime and explicit-legacy modes, server restart test, audit, and fixed-version OpenSpec strict validation; do not treat the startup smoke as packaged multi-renderer or crash qualification.
- [x] 12.7 Inspect the complete local diff for generated artifacts, unrelated changes, secrets, unsafe defaults, misleading claims, and lifecycle leaks.
- [x] 12.8 Keep the acceptance-stage work local until separately authorized. After acceptance, the user renamed the branch to `feat/collab-product-completion` and authorized the single final PR. The previous PR remains closed and the OpenSpec change remains active; no release or automatic merge is authorized.

## 13. Trusted desktop networking and final local acceptance

- [x] 13.1 Capture a failing real Electron network regression and fix CSP using one bounded trusted-server configuration in development and built applications.
- [x] 13.2 Implement a sender-validated main-process invitation command with exact endpoint trust, bounds, timeout, cancellation, redirect rejection, and secret-free errors.
- [x] 13.3 Gate renderer create/join/resume on the same trusted server list and default the panel to its first configured server; reject an untrusted create before writing a pending Enrollment.
- [x] 13.4 Run two real windows through create/invite/join/edit/history/read-only/offline/restart and conflict recovery, retaining repeatable scripts; reauthenticate using retained membership rather than transient revoked access.
- [x] 13.5 Verify WSS and HTTPS invitation issuance with trusted test certificates; explicitly preserve the public-network/platform qualification boundary.
- [x] 13.6 Supply a single-node self-hosted deployment guide and templates, update Core public-interface docs and synchronize obsolete submission claims.
- [x] 13.7 Run final API/type/test/build/Electron/OpenSpec checks and clean-checkout verification; inspect all candidate tracked and untracked files without committing or submitting. Node 22 clean-candidate validation passes; interrupted smoke runs fail explicitly and reclaim their own processes and temporary directory.
