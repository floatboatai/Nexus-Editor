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
- [x] 7.9 Submit one final PR titled `feat(collab): add realtime collaborative editing`, with per-package changes, commands, scenarios, limitations, OpenSpec id, Roadmap #18, dependency review, and honest AI disclosure.
- [x] 7.10 Leave `add-plugin-collab` active; maintainers decide approval, merge, and later archive.
