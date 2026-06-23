# Contributing to Nexus Editor

Thanks for contributing! This is a pnpm + TypeScript monorepo following **Conventional Commits** and **OpenSpec**-driven development.

[中文版](./CONTRIBUTING.zh.md)

> **Before you start:** read [`GOVERNANCE.md`](./GOVERNANCE.md) to understand the project scope, contribution policy (CLA, AI-generated code, dependencies), and what we accept vs. reject. This file covers the *mechanics*; `GOVERNANCE.md` covers the *rules*.

---

## 1. Repository Layout

| Path | Purpose |
|---|---|
| `packages/core` | Editor engine (CodeMirror 6, live preview, AST pipeline) |
| `packages/preset-gfm` | Default GFM preset |
| `packages/plugin-*` | Feature plugins (history / search / slash / toolbar / math / vim) |
| `packages/react`, `packages/vue` | Framework bindings |
| `apps/electron-demo` | Desktop demo / integration playground |
| `openspec/` | Spec-driven development (proposal / specs / archive) |
| `docs/ROADMAP.md` | Current roadmap and ownership |

---

## 2. Branches & Commits

### Branch naming

```
<type>/<scope>-<short-desc>
```

Examples: `feat/toolbar-list-toggle`, `fix/search-regex-escape`, `docs/roadmap-update`.

### Commit message (Conventional Commits)

```
<type>(<scope>): <subject>
```

- **type**: `feat` / `fix` / `perf` / `refactor` / `test` / `docs` / `chore` / `ci` / `build`
- **scope** (must be one of the following or omitted):

  | scope | Maps to |
  |---|---|
  | `core` | `packages/core` |
  | `react` | `packages/react` |
  | `vue` | `packages/vue` |
  | `gfm` | `packages/preset-gfm` |
  | `history` / `search` / `slash` / `toolbar` / `math` / `vim` / `wordcount` | corresponding `plugin-*` |
  | `electron` | `apps/electron-demo` |
  | `live-preview` / `wikilinks` / `image` | core subsystems (historical usage) |
  | `openspec` | `openspec/` |

- **subject**: imperative, English, ≤ 72 chars, no trailing period.

Reference commits already in `main`:

```
feat(image): Obsidian-style image preview with |width syntax and drag-resize
fix(live-preview): height-neutral decorations + always-on block widgets
test(live-preview): regression tests for click-drift invariants
```

### When to split a PR

- One PR, one concern. Don't mix refactor with feature work.
- Multi-package coordinated changes may live in one PR, but the description must have a per-package section.

---

## 3. PR Workflow

### 3.1 When OpenSpec is required

You **must** open an OpenSpec proposal under `openspec/changes/<id>/` before the implementation PR when:

- introducing a new capability (new plugin, new public API)
- making a breaking change to a public API
- cross-package architecture work, or significant performance/security work

You do **not** need a proposal for: bug fixes, internal refactors, dependency bumps, test/doc additions.

See `openspec/AGENTS.md` for the full workflow.

### 3.2 PR checklist

- [ ] Title follows Conventional Commits (same rules as commit messages)
- [ ] CLA signed (the bot will prompt first-time contributors) — see [`GOVERNANCE.md` §6.1](./GOVERNANCE.md#61-contributor-license-agreement-cla)
- [ ] AI-generated code disclosed if applicable ([`GOVERNANCE.md` §6.2](./GOVERNANCE.md#62-ai-generated-code))
- [ ] New runtime dependencies listed with license & rationale ([`GOVERNANCE.md` §6.3](./GOVERNANCE.md#63-new-runtime-dependencies))
- [ ] Change matches project scope ([`GOVERNANCE.md` §4](./GOVERNANCE.md#4-scope-policy))
- [ ] Description explains **why**, not just **what**
- [ ] Tests added (see test matrix below)
- [ ] `pnpm test` passes
- [ ] Affected packages build (`pnpm build`)
- [ ] Public-API changes update the relevant `packages/*/README.md`
- [ ] If touching `packages/core/src/live-preview-table.ts`, walk through the 12 Table Widget rules in `CLAUDE.md`
- [ ] New / changed capability → linked OpenSpec change id

### 3.3 Test matrix

| Change type | Required | Recommended |
|---|---|---|
| `packages/core` rendering | vitest unit tests | manual check in electron-demo |
| `plugin-*` | vitest unit tests | demo integration |
| React/Vue SDK | framework unit tests | mount in demo |
| Live-preview / table / wikilinks | **regression test required** | manual mouse interactions |
| Docs / config only | — | — |

---

## 4. Code Style

- TypeScript strict mode; public exports must have explicit types.
- No "what" comments, no PR/issue back-references in comments. Only write a comment when the **why** is non-obvious (see CLAUDE.md "Doing tasks").
- UI changes must be exercised in the electron-demo. Type checks alone don't validate UI behavior.

---

## 5. Security

- Never commit `.env`, secrets, tokens, or personal vault data.
- Never commit build artifacts (`dist/`, `dist-electron/`, compiled `.js` from `.ts` sources) — they're in `.gitignore` for a reason; don't `git add -f` them.
- Do not `git push --force` to `main` without explicit authorization.
- Vulnerabilities: report privately via GitHub's *"Report a vulnerability"* tab, not in a public issue. See [`GOVERNANCE.md` §7](./GOVERNANCE.md#7-security).

---

## 6. Release

Releases are cut by maintainers via `pnpm publish:packages` + git tag. Contributors don't need npm credentials.
