# Project Context

## Purpose
Nexus Editor is a headless, AST-driven Markdown editor engine for products whose durable document is Markdown text.

## Tech Stack

- TypeScript 5.9 in strict, ESM-only packages
- pnpm 9 workspace; Node.js 22 in CI
- CodeMirror 6 for editor state, transactions, keymaps, and view extensions
- unified / remark / mdast for Markdown parsing and AST processing
- React 19 and Vue 3 thin bindings around `@floatboat/nexus-core`
- Electron demo for integration and multi-window smoke coverage
- Vitest 2 with jsdom; tsup for package builds

## Project Conventions

### Code Style

- Keep TypeScript strict and give public exports explicit types.
- Prefer small public interfaces with complex behavior localized behind them.
- Comments explain non-obvious reasons and invariants, not restate the code.
- Preserve existing user changes and do not commit generated output, secrets, or personal vault data.
- Use the canonical domain terms in `../CONTEXT.md` in specs, code, diagnostics, and documentation.

### Architecture Patterns

- `packages/core` is path-, network-, host-, and framework-agnostic. It owns the Markdown editor model, AST, live preview, widgets, and stable editor primitives.
- `packages/plugin-*` own editor-level capabilities. Host accounts, authorization, cloud services, and product UI remain outside reusable packages.
- React and Vue stay thin and in lockstep; framework bindings must not duplicate core state machines.
- Replaceable external behavior enters through explicit Host-supplied interfaces and adapters. Do not bundle vendor SDKs into core or official plugins.
- `apps/electron-demo` demonstrates integration behavior; it is not a product or the owner of product data models.
- New public interfaces, plugins, cross-package architecture, and significant security or performance work require an approved OpenSpec change before implementation.

### Testing Strategy

- Unit and contract tests use Vitest; DOM behavior runs under jsdom.
- Core rendering, live-preview, table, and wiki-link changes require regression tests. UI behavior also requires an Electron demo check where applicable.
- Public plugin interfaces require `pnpm check:api`; all changes must pass typecheck, tests, affected builds, and the Electron demo build.
- Validate every proposal with `OPENSPEC_TELEMETRY=0 pnpm dlx @fission-ai/openspec@1.11.0 validate <change-id> --strict --no-interactive`; use `validate --all` before handoff.
- Multi-window Electron behavior uses the repository smoke test. Distributed capabilities must define fault, recovery, resource-leak, and performance qualification separately from ordinary unit tests.
- Changes to `packages/core/src/live-preview-table.ts` must exercise every interaction path and follow the Table Widget Development Rules in `AGENTS.md`.

### Git Workflow

- Use one concern per PR and Conventional Commits with the scopes documented in `CONTRIBUTING.md`.
- Branches use `<type>/<scope>-<short-desc>`; Codex-created branches use the configured `codex/` prefix unless the user requests otherwise.
- An OpenSpec proposal is reviewed and approved before its implementation PR. Completed changes are archived only after implementation and validation are complete.
- Roadmap priority is set by maintainers; proposals may link a roadmap item but must not silently reprioritize it.

## Domain Context
The canonical ubiquitous language is in `../CONTEXT.md`. Markdown text remains the durable user document. During an explicitly enrolled collaboration session, a Collaborative Document is authoritative and the Editor plus Markdown file are projections of it.

## Important Constraints
- Nexus remains a headless editor engine; accounts, billing, invitations, product navigation, and general-purpose UI are Host responsibilities.
- Do not expose Node.js, Electron IPC, absolute filesystem paths, credentials, or Host internals through public editor/plugin interfaces.
- Runtime dependencies require a compatible license, explicit rationale, maintainer approval, and a documented replacement cost.
- React and Vue public behavior stays in lockstep.
- Local Proposal filtering, committed update observation, undo semantics, IME behavior, and editable Widget state must remain deterministic across Host integrations.
- AI-assisted functional code must comply with `GOVERNANCE.md`; contributors must understand and defend every submitted implementation.

## External Dependencies
- CodeMirror and unified ecosystem packages are foundational runtime dependencies.
- Host applications supply filesystem/content adapters, persistence, network transport, authentication, authorization, and product UI.
- Collaboration may use Yjs and y-protocols only after the relevant OpenSpec dependency review records versions, licenses, bundle impact, and qualification evidence.
- No external provider, database, or commercial service is part of the stable Nexus interface unless an approved change explicitly says otherwise.
