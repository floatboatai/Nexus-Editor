# Implementation Tasks

## 1. Headless renderer (`packages/core/src/render-html.ts`)

- [x] 1.1 Add `HtmlRendererOptions` (`plugins`, `transform`) and
  `HtmlRenderer` (`render`) types.
- [x] 1.2 Implement `createHtmlRenderer()`: remark-parse → each plugin's
  `remarkPlugins` in order → optional `transform` → remark-rehype →
  rehype-stringify; `freeze()` the processor once at creation.
- [x] 1.3 Implement `renderMarkdownToHtml()` as a one-shot wrapper.
- [x] 1.4 Export both functions and both types from
  `packages/core/src/index.ts`.

## 2. Reuse in the editor (`packages/core/src/editor.ts`)

- [x] 2.1 Replace the private `markdownToHtml()` with a lazily-created
  `HtmlRenderer` whose `transform` applies
  `applyMarkdownTransformSnapshots(view.state, tree)`.
- [x] 2.2 Drop the now-unused `remark-rehype` / `rehype-stringify` imports.

## 3. Tests

- [x] 3.1 `packages/core/test/render-html.test.ts` (`@vitest-environment node`):
  `document` / `window` are undefined; basic rendering; empty input; plugin
  `remarkPlugins` honoured (GFM table); raw HTML dropped; `transform` hook;
  renderer reuse; factory ≡ one-shot helper.
- [x] 3.2 `packages/core/test/render-html-editor.test.ts` (jsdom):
  `renderMarkdownToHtml()` output is identical to `editor.exportHTML()` for
  the same document and plugins.
- [x] 3.3 `packages/react/test/editor-ssr.test.tsx` (node):
  `renderToString(<Editor />)` yields the container `<div>` with
  pass-through attributes.
- [x] 3.4 `packages/vue/test/editor-ssr.test.ts` (node):
  `renderToString(createSSRApp(...))` yields the container `<div>`.

## 4. Docs

- [x] 4.1 `README.md` / `README.zh.md`: "Server-side rendering & SSG"
  section under API Reference with a Next.js App Router example.
- [x] 4.2 `packages/core/README.md`: API section for the two functions.
- [x] 4.3 `docs/ROADMAP.md` / `docs/ROADMAP.zh.md`: new Core Editor row
  linking this change.

## 5. Verification

- [x] 5.1 `pnpm typecheck`, `pnpm test` and `pnpm build` pass locally.
