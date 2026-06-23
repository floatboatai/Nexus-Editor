# Governance

This document describes how the Nexus-Editor project is governed and what contributions we accept.

If you only want to send a small fix, you can stop reading after §6. The rest exists so that the project's direction stays stable as we grow.

[中文版 — TODO](./GOVERNANCE.zh.md)

---

## 1. Project Ownership

- **Nexus-Editor** is an open-source project under the [`floatboatai`](https://github.com/floatboatai) GitHub organization.
- Licensed under [MIT](./LICENSE). All accepted contributions are licensed under MIT (see §6.1).
- The names *"Nexus-Editor"* and *"floatboat"* and their associated logos are reserved by the project owners. The MIT license grants rights to the code, **not** to the trademarks — please do not use these names for forks, derivatives, or commercial offerings without prior written permission.

## 2. Maintainers

Maintainers are the people with write access to this repository. Their role:

- Triage and review pull requests
- Decide what enters `docs/ROADMAP.md`
- Approve and archive OpenSpec proposals (see [`openspec/AGENTS.md`](./openspec/AGENTS.md))
- Cut releases via `pnpm publish:packages`

The current maintainer list is whoever has the **Maintain** or higher role in this repository's GitHub permissions. To propose adding or removing a maintainer, open an issue with the `governance` label.

## 3. Decision Making

- **Bug fixes, internal refactors, docs, tests** — any maintainer can merge after one review.
- **Public API additions, new plugins, breaking changes, security-sensitive work** — require an OpenSpec proposal first ([`CONTRIBUTING.md`](./CONTRIBUTING.md) §3.1), and the proposal must be approved by a maintainer before implementation begins.
- **Roadmap priority** — set at iteration kickoff by maintainers. Drive-by priority edits in feature PRs are not accepted.

## 4. Scope Policy

**Nexus is a headless, AST-driven Markdown editor engine.** This is the load-bearing sentence in [`README.md`](./README.md), and it determines what we accept.

### What's in scope

- `packages/core` — CodeMirror 6 state, AST pipeline, live preview, widget API, events
- `packages/preset-gfm` — GFM-compliant Markdown features (tables, task lists, strikethrough)
- `packages/plugin-*` — editor-level features (history, search, slash menu, toolbar, math, vim)
- `packages/react` / `packages/vue` — thin framework bindings around `packages/core`
- `apps/electron-demo` — a demonstration of engine capabilities only

### What is **not** in scope (and will be rejected even if technically well-built)

1. **AI / LLM integrations** of any kind — neither in `packages/` nor in `apps/electron-demo`. This includes: text generation, AI rewriting, autocomplete via cloud LLMs, agent panels, embedded AI tools. These are the responsibility of the host application that depends on Nexus.
2. **Bundled SDKs for specific vendors** — OpenAI, Anthropic, Volcano/Doubao, OpenRouter, cloud storage SDKs, etc. Adapters and pluggable interfaces in `core` are acceptable; bundling a specific vendor is not.
3. **General-purpose UI component libraries** in this repository (toast, dialog, modal, etc.). Nexus is headless; UI belongs in the host application or in dedicated third-party packages.
4. **Product features** that are not editor primitives — e.g. notebook management, cloud sync UI, account systems, in-app purchase flows.
5. **Schema validation / content linting** beyond what the AST already exposes. Hosts can write these on top of `editor.getAst()`.

If you need any of the above, build it in your host application using Nexus as a dependency.

### Demo is not a product

`apps/electron-demo` exists so people can see and try the engine. It is **not** a reference desktop product. PRs that add product-level surface area (file management UI, AI sidebars, agent panels, settings systems) to the demo are out of scope.

## 5. Module Ownership

| Area | Outside PRs |
|---|---|
| `packages/core` | Bug fixes welcome; new public APIs require OpenSpec + maintainer approval |
| `packages/preset-gfm` | Bug fixes welcome; new features require OpenSpec |
| `packages/plugin-*` | New plugins must match a `docs/ROADMAP.md` entry; otherwise file an issue first |
| `packages/react` / `packages/vue` | Bindings stay in lockstep — single PR must update both |
| `apps/electron-demo` | Bug fixes welcome; new features only if they demonstrate an engine capability |
| `openspec/` | Proposals welcome via the OpenSpec workflow |
| Release scripts, CI workflows | Maintainer-led; outside changes require a security review |

## 6. Contribution Policy

### 6.1 Contributor License Agreement (CLA)

This project uses [CLA Assistant](https://cla-assistant.io/floatboatai/Nexus-Editor) to manage contributor license agreements. The first time you open a pull request, the CLA bot will ask you to sign once via your GitHub account. The signature covers all of your future contributions to this project; you will not be asked again.

By signing the CLA you grant `floatboat`:
- A perpetual, worldwide, irrevocable copyright license including the right to **sublicense and distribute** your contribution (CLA §2). This is what gives the project room to evolve its distribution model (e.g. dual licensing, sub-license to commercial offerings) without re-asking every contributor.
- A patent license covering claims your contribution necessarily reads on (CLA §3).
- Representations that the contribution is **your original creation**, that you have rights to grant it, and that it does not embed third-party copyrighted material without permission (CLA §4).

You retain copyright of your work.

Pull requests with an unsigned CLA will not be merged.

### 6.2 AI-Generated Code

**Pull requests whose functional code is primarily generated by AI tools are not accepted.**

- ✅ Acceptable: autocomplete suggestions, AI-assisted refactor proposals you reviewed line-by-line, AI-generated tests for code you wrote yourself, AI-written comments or docs.
- ❌ Not acceptable: "implement feature X" → pasted whole into a PR, where the contributor cannot explain or defend the design decisions.

You **must disclose** AI assistance in the PR description (the template has a checkbox).

**Why this matters even though we have a CLA — the CLA is exactly what makes this a problem:**

- CLA §4(b) requires that each contribution is **your original creation**. The US Copyright Office has held that purely AI-generated content is not copyrightable; submitting such code as your own contribution misrepresents §4(b).
- CLA §4(c) requires that your contribution **does not include third-party copyrighted material** without permission. Large-model outputs can include verbatim fragments of GPL/AGPL training data — material the contributor has neither the right nor the awareness to license to us.
- CLA §6 obligates you to notify us if any of these representations turn out to be inaccurate.

A single contaminated PR can force us to rewrite affected files and notify downstream users. And on top of the legal side: hard-to-defend code is hard to maintain — if the contributor cannot explain it during review, neither can we.

### 6.3 New Runtime Dependencies

Adding a new runtime dependency (anything in `dependencies`, not `devDependencies`) requires:

- License compatible with MIT. Specifically rejected: GPL, AGPL, SSPL, BUSL, CC-BY-NC. ISC/BSD/Apache-2.0/MIT are fine.
- Listed in the PR description with: package name, version, license, why it's needed, and what we'd lose by writing it ourselves.
- Maintainer approval before merge.

Build-time and test-time dependencies (`devDependencies`) have a lighter bar but still must be MIT-compatible.

### 6.4 Build Artifacts and Secrets

The following must **never** be committed and will block PRs:

- Build outputs: `dist/`, `dist-electron/`, `release/`, compiled `.js` from `.ts` sources
- Environment files: `.env`, `.env.local`, anything that isn't `.env.example`
- Credentials of any kind, even placeholder/test ones
- Personal vault data, screen recordings of private documents, internal company information

The repo `.gitignore` covers most of these — if a file shows up in your diff that matches a `.gitignore` pattern, you forced it in and should back it out.

## 7. Security

Report security issues privately rather than via public issues. Email the maintainers, or use GitHub's *"Report a vulnerability"* tab on the Security page. Public disclosure should wait until a fix has shipped.

A separate `SECURITY.md` may be added; until then, this section is authoritative.

## 8. Code of Conduct

We follow the spirit of the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). In short: be kind, assume good faith, criticize ideas not people, and respect that maintainer time is limited.

Maintainers reserve the right to close PRs and issues, and to block repeat offenders, without further discussion.

## 9. Changes to This Document

Material changes to this document (scope policy, DCO, AI policy, license terms) require:

- An issue with the `governance` label, open for at least 7 days
- Approval from a majority of active maintainers
- A PR linking the issue

Editorial fixes (typos, link updates, clarifications without changing meaning) can be merged by any maintainer.
