# Nexus-Editor Architecture

[中文完整版](./ARCHITECTURE.zh.md)

This document summarizes how the Nexus-Editor monorepo is structured. For the full module-by-module walkthrough (with diagrams), see **[ARCHITECTURE.zh.md](./ARCHITECTURE.zh.md)**.

---

## Overview

Nexus-Editor is a **headless, AST-driven Markdown editor engine**. Markdown text is the source of truth; the engine maintains an **mdast** tree on every edit for TOC, link indexing, live preview, and plugins.

**Stack:** CodeMirror 6 (editing) · Lezer (incremental parse) · unified/remark (widgets, export, transforms) · optional React/Vue bindings.

**Design principles:**

| Principle | Meaning |
|-----------|---------|
| Headless | Logic + CM6 mount point only; styling is host-owned |
| Markdown as truth | Document is a `.md` string, not an internal JSON tree |
| AST-driven | Real-time mdast for preview, plugins, and app features |
| Local-first | File IO hooks (`onAssetUpload`, silent `setDocument`, debounced `onChange`) |
| Framework-agnostic | Core + thin React/Vue adapters + vanilla Electron demo |

---

## Monorepo layout

```
packages/core          @floatboat/nexus-core       — engine
packages/react         @floatboat/nexus-react      — React binding
packages/vue           @floatboat/nexus-vue        — Vue 3 binding
packages/preset-gfm    @floatboat/nexus-preset-gfm — GFM remark preset
packages/plugin-*      official plugins            — history, search, slash, toolbar, math, vim
apps/electron-demo     reference desktop app       — vault, backlinks, outline
```

Managed with **pnpm workspaces** ([pnpm-workspace.yaml](../pnpm-workspace.yaml)). Build: **tsup** per package; test: **Vitest** at repo root.

---

## Data flow

1. User input → CM6 `Transaction` → `EditorState`
2. Lezer syntax tree → `lezer-mdast-adapter` → **mdast Root** (hot path, synchronous)
3. mdast → Live Preview decorations + Widget decorations + `onChange(doc, ast)`
4. Remark used for widgets, `exportHTML()`, and `remarkPlugins` transforms (not the main typing path)

Entry point: `createEditor()` in [packages/core/src/editor.ts](../packages/core/src/editor.ts) → [EditorAPI](../packages/core/src/types.ts).

---

## Plugin tiers (`NexusPlugin`)

| Tier | Fields | Use case |
|------|--------|----------|
| 1 — Business | `shortcuts`, `commands`, `slashCommands`, `handlers` | Keymaps, slash menu, paste/drop |
| 2 — Syntax & render | `remarkPlugins`, `widgets` | GFM, math, custom blocks |
| 3 — CM6 raw | `cmExtensions` | History, vim, search panel |

All plugins depend only on `core`; the host composes them in `plugins: [...]`.

---

## Framework bindings

| Package | Role |
|---------|------|
| `@floatboat/nexus-react` | `useEditor` + `<Editor />` — wraps `createEditor`, forwards container attrs, exposes `onReady` |
| `@floatboat/nexus-vue` | Same semantics for Vue 3 |

`UseEditorConfig = Omit<EditorConfig, "container"> & { onReady?: (editor: EditorAPI) => void }`.

---

## Electron demo

[apps/electron-demo/](../apps/electron-demo/) wires core + GFM + history + toolbar + search + wikilinks, with vault IPC, link index, outline, and backlinks panels. It is the reference **local-first** integration (no React/Vue).

---

## Related docs

- [ROADMAP.md](./ROADMAP.md) — feature priorities and package ownership
- [prd.md](../prd.md) — product design (Chinese)
- [openspec/AGENTS.md](../openspec/AGENTS.md) — spec-driven change process
