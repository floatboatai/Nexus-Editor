<div align="center">

# Nexus-Editor

**A headless, AST-driven Markdown editor engine — built for makers who need real Markdown, not another WYSIWYG.**

Powered by [CodeMirror 6](https://codemirror.net/) + the [unified](https://unifiedjs.com/) ecosystem.
Framework-agnostic core · Official React & Vue bindings · MIT licensed.

[中文文档](./README.zh.md) · [Quick Start](#-quick-start) · [Why Nexus?](#-why-nexus-editor) · [Roadmap](#-roadmap) · [Contributing](#-contributing)

</div>

---

## 🗺️ Roadmap (TL;DR)

We ship in priority tiers — **P0 is what we're working on right now**.

| Tier | Theme | Highlights |
|---|---|---|
| **P0 — Now** | Core API completeness | `getSelectedText()`, slash command sorting, `<Editor />` `onReady`, TS strict coverage |
| **P1 — Next** | Power-user features | Multi-cursor, regex search, undo/redo grouping, widget API standardization, Electron packaging |
| **P2 — Mid-term** | UX & ecosystem | Advanced toolbar (emoji / table / color), fuzzy search, sync-scroll preview, web-component wrapper |
| **P3 — Long-term** | Collaboration | Realtime CRDT collab, shared comments / @mention, plugin hot-reload |

👉 **Full roadmap with package ownership, status, and OpenSpec linkage:** [`docs/ROADMAP.md`](./docs/ROADMAP.md)

---

## 💡 Why Nexus-Editor?

Markdown editing on the web is a crowded space — yet every existing option forced us to compromise on something fundamental. We built Nexus because we needed an editor that treats **Markdown text as the source of truth**, stays out of the way of your UI, and is honest about extension points.

### Side-by-side comparison

| | **Nexus** | **Tiptap** | **Lexical** | **Milkdown** | **MDXEditor** | **@uiw/react-md-editor** |
|---|---|---|---|---|---|---|
| **Foundation** | CodeMirror 6 + unified | ProseMirror | Built from scratch (Meta) | ProseMirror + Remark | Lexical | CodeMirror + Marked |
| **Source of truth** | **Markdown text** | JSON tree | JSON tree | ProseMirror doc | Lexical state | Markdown text |
| **Round-trip safe** | ✅ Lossless | ⚠️ Format can drift | ⚠️ Markdown is import/export | ⚠️ Through PM schema | ⚠️ Through Lexical | ✅ |
| **UI model** | **Headless** | Headless | Headless-ish | WYSIWYG (built-in UI) | WYSIWYG | Split-pane |
| **Live preview** | **Obsidian-style inline** | None (BYO) | None (BYO) | Full WYSIWYG | Full WYSIWYG | Side-by-side pane |
| **Framework support** | React · Vue · Vanilla | React · Vue · Svelte · Vanilla | React-first | React · Vue · Vanilla | React only | React only |
| **Plugin tiers** | **3** (shortcut / AST / CM6) | 1 (Tiptap extension) | 1 (node + transform) | 1 (Milkdown plugin) | 1 (Lexical plugin) | None |
| **Bundle (core, approx.)** | Small (CM6 ~110KB) | Medium (PM + ext.) | ~22KB core | ~125KB / ~40KB gz | ~851KB gz | Medium |
| **Local-first / file IO hooks** | ✅ First-class | ❌ | ❌ | ❌ | ❌ | ❌ |
| **License** | MIT | MIT (+ paid cloud) | MIT | MIT | MIT | MIT |

> Numbers are taken from public docs and recent third-party reviews. Bundle sizes vary with plugins enabled — treat the column as a rough order-of-magnitude.

### What this means in practice

- **Tiptap / Lexical / Milkdown / MDXEditor** all keep an internal JSON document model. Markdown is an import/export concern — round-tripping a `.md` file through them can quietly drift (lost soft-breaks, reordered attributes, normalized tables). If your product *is* the Markdown file (notes app, static-site authoring, LLM writing tools), this matters.
- **@uiw/react-md-editor** keeps Markdown as the document, but offers a classic split-pane preview — no inline syntax reveal, no widget API, React only.
- **Obsidian** has the UX we love, but it's closed source. You can't embed its engine in your own product.
- **Nexus** keeps Markdown as the document **and** gives you Obsidian-style live preview, a widget API, three plugin altitudes, and framework-agnostic bindings — without the WYSIWYG lock-in.

If you're building **a note-taking app, a docs CMS, a static-site authoring tool, a Markdown-native PKM, or an LLM-powered writing assistant**, Nexus is meant to be the engine you don't have to fight.

---

## 🚀 Quick Start

### 1. Install

```bash
# pnpm (recommended)
pnpm add @floatboat/nexus-core @floatboat/nexus-preset-gfm

# or npm / yarn
npm install @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

### 2. Pick your flavor

<details open>
<summary><b>React</b> — the fast path</summary>

```tsx
import { Editor } from "@floatboat/nexus-react";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

export default function App() {
  return (
    <Editor
      initialValue="# Hello, Nexus 👋"
      plugins={[createGfmPreset()]}
      livePreview
      onChange={(doc, ast) => console.log(doc)}
    />
  );
}
```

> 💡 **New to CodeMirror?** You don't need to know it. `<Editor />` handles the lifecycle — just drop it in.
</details>

<details>
<summary><b>Vue 3</b></summary>

```vue
<script setup>
import { Editor } from "@floatboat/nexus-vue";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
</script>

<template>
  <Editor
    initial-value="# Hello"
    :plugins="[createGfmPreset()]"
    :live-preview="true"
    @change="(doc) => console.log(doc)"
  />
</template>
```
</details>

<details>
<summary><b>Vanilla / Plain DOM</b></summary>

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# Hello\n\nStart typing...",
  plugins: [createGfmPreset(), createHistoryPlugin()],
  livePreview: true,
  onChange(doc, ast) {
    console.log("Markdown:", doc);
    console.log("AST:", ast);
  },
});
```
</details>

### 3. New here? Read this first

> **🐣 Things we wish someone had told us when we started**
>
> - **You don't need to know CodeMirror.** The React / Vue wrapper handles the lifecycle. You only meet CodeMirror if you write a low-level plugin.
> - **Headless means no theme.** We ship logic, not looks. Plan a few hours for styling — the Electron demo is a copy-pasteable starting point.
> - **Live preview is opt-in.** If you just want a raw Markdown editor, leave it off and you get a clean text-editing experience.
> - **The AST is `mdast`** — the same tree used by `remark` and the unified ecosystem. If you've never seen it, the [mdast spec](https://github.com/syntax-tree/mdast) is the one-page cheat sheet you actually need.
> - **Don't auto-save on every keystroke.** `onChange` fires constantly — debounce before writing to disk or hitting the network.
> - **Blank screen?** Nine times out of ten, the container has no height. Give it one and the editor appears.
> - **Lost?** Open an issue with the `question` label — we'd rather answer the same question 20 times than have you give up.

### 4. Try the demo

```bash
git clone https://github.com/floatboatai/Nexus-Editor.git
cd Nexus-Editor
pnpm install
pnpm dev:electron-demo
```

A real Electron app with file IO, live preview, and every plugin enabled — the fastest way to see what's possible.

---

## 📦 Packages

<details>
<summary><b>Full package list (11 packages)</b> — click to expand</summary>

| Package | Description |
|---|---|
| `@floatboat/nexus-core` | Editor engine — CM6 state, AST pipeline, live preview, events, widget API |
| `@floatboat/nexus-react` | React binding — `useEditor` hook and `<Editor />` component |
| `@floatboat/nexus-vue` | Vue 3 binding — `useEditor` composable |
| `@floatboat/nexus-preset-gfm` | GitHub Flavored Markdown preset (tables, strikethrough, task lists) |
| `@floatboat/nexus-plugin-history` | Undo/redo with `Ctrl+Z` / `Ctrl+Shift+Z` |
| `@floatboat/nexus-plugin-search` | Search and replace helpers |
| `@floatboat/nexus-plugin-slash` | Slash command detection, ranking, and a vanilla-DOM floating menu UI |
| `@floatboat/nexus-plugin-toolbar` | Toolbar primitives for formatting commands |
| `@floatboat/nexus-plugin-math` | Inline / block math rendering (KaTeX) |
| `@floatboat/nexus-plugin-vim` | Vim keybindings powered by `@replit/codemirror-vim` |
| `@floatboat/nexus-plugin-wordcount` | Markdown-aware word / character / CJK / reading-time stats + ARIA-live status bar |

</details>

---

## ✨ Features

- **Headless** — no built-in UI. Render with any framework or plain DOM.
- **AST-Driven** — real-time Markdown → mdast parsing with every keystroke.
- **Live Preview** — inline rendering that reveals raw syntax on cursor focus (Obsidian-style).
- **Plugin System** — three tiers: shortcuts & slash commands, remark plugins & widgets, raw CM6 extensions.
- **Event System** — subscribe to `change`, `focus`, `blur`, `selectionChange`, `slashMenuChange`.
- **Widget API** — render custom components for any AST node type (code blocks, tables, diagrams).
- **Local-First** — built for Electron/Tauri with file IO hooks and debounced parsing.

---

## 📖 API Reference

<details>
<summary><b>Editor API</b> — methods and events</summary>

`createEditor(config)` returns an `EditorAPI` with:

```ts
editor.getDocument()          // current Markdown string
editor.getAst()               // current mdast Root
editor.setDocument(md)        // replace entire document
editor.setDocument(md, { silent: true, preserveSelection: true })
editor.setDocument(md, { selection: { anchor: 0 } })
editor.setSelection(pos)      // move cursor
editor.focus() / editor.blur()
editor.destroy()

// Event system
editor.on("change", (doc, ast) => { ... })
editor.on("selectionChange", ({ anchor, head }) => { ... })
editor.on("slashMenuChange", ({ isOpen, query, commands, coords }) => { ... })
editor.off("change", handler)

// Coordinates (for floating UI)
editor.getCoordsAtPos(pos)     // { left, right, top, bottom } | null
```

</details>

<details>
<summary><b>Plugin authoring</b> — three tiers, one shape</summary>

```ts
const myPlugin: NexusPlugin = {
  name: "my-plugin",

  // Tier 1: Shortcuts & slash commands
  shortcuts: [{ key: "Mod-b", run: (editor) => { /* toggle bold */ return true; } }],
  slashCommands: [{ id: "heading", title: "Heading", keywords: ["h1"] }],

  // Tier 2: AST & widgets
  remarkPlugins: [remarkMath],
  widgets: [{
    nodeType: "code",
    match: (node) => node.lang === "mermaid",
    render: (node, source) => renderMermaidChart(source),
    destroy: (el) => el.remove(),
  }],

  // Tier 3: Raw CM6
  cmExtensions: [myCodeMirrorExtension],
};
```

</details>

---

## 🛠️ Development

<details>
<summary><b>Build, test, and run the demo</b></summary>

```bash
pnpm install
pnpm build          # build all packages
pnpm test           # run all tests

# Electron demo
pnpm dev:electron-demo
```

</details>

---

## 🤝 Contributing

We'd love your help — whether it's a typo fix, a new plugin, or a deep core change. Here's the **5-minute version**:

1. **Fork this repo** — click the **Fork** button at the top of the page.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/Nexus-Editor.git
   cd Nexus-Editor
   pnpm install
   ```
3. **Create a branch** following our naming convention (see `CONTRIBUTING.md`):
   ```bash
   git checkout -b feat/<scope>/<short-description>
   ```
4. **Make your change** — write tests, run `pnpm test`, run `pnpm build`.
5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):
   ```bash
   git commit -m "feat(core): add getSelectedText() API"
   ```
6. **Push** to your fork and **open a Pull Request** against `main`.

### Before opening a PR, please read

- [CONTRIBUTING.md](./CONTRIBUTING.md) — branch naming, Conventional Commits scope whitelist, when to file an OpenSpec proposal, test matrix.
- [.github/PULL_REQUEST_TEMPLATE.md](./.github/PULL_REQUEST_TEMPLATE.md) — the PR description template.
- [openspec/AGENTS.md](./openspec/AGENTS.md) — required for new capabilities or breaking API changes.

> 🟢 **Good first issues** are labeled [`good first issue`](https://github.com/floatboatai/Nexus-Editor/labels/good%20first%20issue) — start there if you're new to the codebase.

---

## 📄 License

[MIT](./LICENSE) © floatboat

---

<div align="center">

## ⭐ Like what you see?

**If Nexus-Editor saved you from writing yet another Markdown editor from scratch, the kindest thing you can do is hit the ⭐ button** — it helps other devs find the project, and it genuinely makes our day.

### Spread the word

- 🐦 **Tweet about it** — tag us, we'll retweet
- 📝 **Blog about your integration** — open a PR to list it in `SHOWCASE.md`
- 💬 **Share in your team's Slack / Discord** — that's how 90% of devs discover tools
- 🐛 **Open an issue** if something feels off — even "this is confusing" is valuable feedback

**Built with ❤️ for makers who still believe Markdown is the right format.**

</div>
## 🔧 Code Quality

Nexus-Editor enforces high code quality standards through automated tooling:

### Quality Tools
- **ESLint**: Static code analysis with TypeScript support
- **Prettier**: Consistent code formatting
- **TypeScript**: Strict type checking
- **Husky**: Git hooks for pre-commit checks
- **lint-staged**: Run checks on staged files only

### Commands
```bash
# Run all quality checks
pnpm run check

# Format code
pnpm run format

# Lint code
pnpm run lint

# Fix linting issues
pnpm run lint:fix
