# Change: Add missing features for production-ready markdown editor library

## Why
Nexus-Editor has a solid core (inline formatting, headings, code blocks, tables, lists, images, math) but lacks several features expected from a production markdown library. These gaps block adoption as an Obsidian-grade editing experience: no theme system (dark mode impossible), no markdown auto-continuation, broken link interactions in mark mode, no folding, no footnotes, no mermaid diagrams, and no accessibility support.

## What Changes
- **P0: Editing Experience Basics** — Fix nested formatting, add Ctrl+Click links, footnote rendering, autolink rendering, indented code blocks
- **P1: Advanced Editing** — Markdown auto-continuation (list/quote/heading), fold/unfold for headings and code blocks, list item drag reorder, hover previews for links/images
- **P2: Ecosystem** — Theme system (light/dark/custom), i18n framework, TOC extraction API, markdown-to-HTML export, Mermaid diagram plugin
- **P3: Quality** — Accessibility (ARIA attributes), performance benchmarks, API documentation

## Impact
- Affected specs: live-preview, editor-core, theming (new), plugins
- Affected code: `packages/core/src/live-preview.ts`, `packages/core/src/live-preview-ranges.ts`, `packages/core/src/live-preview-table.ts`, `packages/core/src/editor.ts`, `packages/core/src/types.ts`, new plugin packages
- New packages: `@floatboat/nexus-plugin-mermaid`, theme system in core
- **No breaking changes** to existing API
