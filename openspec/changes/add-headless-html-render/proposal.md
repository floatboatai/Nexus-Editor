# Change: Add headless HTML rendering to `@floatboat/nexus-core` (SSR / SSG)

## Why

`EditorAPI.exportHTML()` is the only way to turn a Nexus document into HTML,
and it lives on a mounted editor: it needs a container element, a CodeMirror
`EditorView` and a `document` global. Verified on `main`: importing
`@floatboat/nexus-core` in a plain Node.js process succeeds, but
`createEditor()` throws `ReferenceError: document is not defined`, so there is
no supported way to produce HTML on a server.

That blocks use cases the README explicitly targets ("a docs CMS, a
static-site authoring tool, an LLM-powered writing assistant"):

- **SEO / first paint.** A Next.js / Nuxt / Astro page that shows a Nexus
  document must ship the Markdown to the browser and let the editor render it
  client-side. Crawlers see an empty `<div>`; users see nothing until the
  CodeMirror bundle has executed.
- **SSG builds and CLIs.** Generating HTML for hundreds of notes at build time
  currently means re-implementing the pipeline (remark-parse → plugin remark
  transforms → remark-rehype → rehype-stringify) outside the editor.
- **Drift.** Anything re-implemented outside `exportHTML()` diverges from what
  the editor exports the moment a plugin changes.

The pipeline itself is already pure — the private `markdownToHtml()` in
`packages/core/src/editor.ts` touches nothing DOM-related. It is just not
reachable without an editor instance.

## What Changes

- **New module `packages/core/src/render-html.ts`**, exported from
  `@floatboat/nexus-core`:
  - `createHtmlRenderer(options?) → HtmlRenderer` — builds the unified
    pipeline once (same "build once, freeze" pattern as `createParser()`) and
    returns `{ render(markdown): string }`.
  - `renderMarkdownToHtml(markdown, options?) → string` — one-shot wrapper.
  - `HtmlRendererOptions { plugins?: NexusPlugin[]; transform?: (tree: Root) => Root }`
    and `HtmlRenderer` types.
- **`EditorAPI.exportHTML()` delegates to the shared renderer** (created
  lazily on first call, reused afterwards) instead of the private
  `markdownToHtml()`, so browser export and headless render cannot drift.
  Output is unchanged and covered by an equivalence test.
- **SSR contract tests for the framework bindings.** `<Editor />` from
  `@floatboat/nexus-react` and `@floatboat/nexus-vue` renders only its
  container `<div>` under `react-dom/server` / `vue/server-renderer` in a
  Node (no-DOM) vitest environment. This guards behaviour that already
  holds; no binding code changes.
- **Docs.** README / README.zh gain a "Server-side rendering & SSG" section
  with a Next.js App Router example; `packages/core/README.md` documents the
  API; ROADMAP gets a Core Editor row.

No breaking changes. No new runtime dependencies — `remark-parse`,
`remark-rehype`, `rehype-stringify` and `unified` are already dependencies of
`@floatboat/nexus-core`.

## Impact

- Affected specs: `html-rendering` (NEW capability).
- Affected code:
  - `packages/core/src/render-html.ts` (NEW), `packages/core/src/index.ts`,
    `packages/core/src/editor.ts`
  - `packages/core/test/render-html.test.ts` (NEW, `@vitest-environment node`),
    `packages/core/test/render-html-editor.test.ts` (NEW, jsdom)
  - `packages/react/test/editor-ssr.test.tsx` (NEW, node),
    `packages/vue/test/editor-ssr.test.ts` (NEW, node)
  - `README.md`, `README.zh.md`, `packages/core/README.md`,
    `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`
- Out of scope (explicit non-goals):
  - Server-rendering the *live preview* (CodeMirror decorations, widgets).
    The static HTML is the crawlable / first-paint representation; the editor
    hydrates on the client.
  - Rendering mermaid diagrams, highlight.js tokens or KaTeX server-side.
    Those are live-preview widgets and are not part of the `exportHTML()`
    pipeline today.
  - Raw HTML pass-through (`allowDangerousHtml`). Safe-by-default matches
    current `exportHTML()` behaviour; an opt-in can be a follow-up change.
  - An `ssrHtml` / placeholder prop on `<Editor />` that shows pre-rendered
    HTML until hydration. Hosts can compose this themselves (see the README
    example); a built-in prop deserves its own proposal.
