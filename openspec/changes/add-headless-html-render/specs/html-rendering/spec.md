# HTML Rendering Spec — headless Markdown → HTML

## ADDED Requirements

### Requirement: Headless HTML Renderer Factory

`@floatboat/nexus-core` SHALL export
`createHtmlRenderer(options?: HtmlRendererOptions): HtmlRenderer`. The
returned renderer SHALL expose `render(markdown: string): string` and SHALL
NOT require a DOM (`document`, `window`), a container element or an
`EditorView`. The renderer SHALL build its unified pipeline once at creation
and reuse it for every `render()` call.

#### Scenario: Render in a Node.js process without a DOM
- **WHEN** `createHtmlRenderer().render("# Hello")` is invoked where
  `typeof document === "undefined"`
- **THEN** it SHALL return HTML containing `<h1>Hello</h1>` and SHALL NOT throw

#### Scenario: Reuse across documents
- **WHEN** one renderer (with the GFM preset) renders `"~~gone~~"` and then
  `"# Second"`
- **THEN** the second result SHALL contain `<h1>Second</h1>` and SHALL NOT
  contain `<del>`

#### Scenario: Empty document
- **WHEN** `render("")` is invoked
- **THEN** it SHALL return `""`

### Requirement: Plugin Remark Transforms Are Honoured

The renderer SHALL apply the `remarkPlugins` of every `NexusPlugin` in
`options.plugins`, in plugin order, before converting the tree to HTML.

#### Scenario: GFM table
- **WHEN** a GFM table source is rendered with `plugins: [createGfmPreset()]`
- **THEN** the output SHALL contain `<table>`
- **AND** the same source rendered without plugins SHALL NOT contain `<table>`

### Requirement: Optional mdast Transform Hook

`HtmlRendererOptions.transform?: (tree: Root) => Root` SHALL be applied after
all plugin remark transforms and before HTML conversion. The tree returned by
the hook SHALL be the tree that is serialised.

#### Scenario: Transform changes heading depth
- **WHEN** `"# Title"` is rendered with a `transform` that sets every heading
  `depth` to `2`
- **THEN** the output SHALL contain `<h2>Title</h2>` and SHALL NOT contain `<h1>`

### Requirement: Raw HTML Is Not Passed Through

The renderer SHALL drop raw `html` nodes from the source (remark-rehype
default) so the output can be embedded without an additional sanitiser.

#### Scenario: Script tag in source
- **WHEN** `"before\n\n<script>alert(1)</script>\n\nafter"` is rendered
- **THEN** the output SHALL NOT contain `<script`
- **AND** SHALL contain `<p>before</p>` and `<p>after</p>`

### Requirement: One-Shot Helper

`@floatboat/nexus-core` SHALL export
`renderMarkdownToHtml(markdown: string, options?: HtmlRendererOptions): string`,
equivalent to `createHtmlRenderer(options).render(markdown)`.

#### Scenario: Equivalence with the factory
- **WHEN** the same markdown and options are rendered via
  `renderMarkdownToHtml()` and via `createHtmlRenderer().render()`
- **THEN** both results SHALL be identical strings

### Requirement: Editor Export Uses the Same Pipeline

`EditorAPI.exportHTML()` SHALL produce output identical to
`renderMarkdownToHtml(editor.getDocument(), { plugins })` for the same plugin
list, with the editor's dynamic markdown transform snapshots applied through
the `transform` hook.

#### Scenario: Browser export equals headless render
- **WHEN** an editor is created with a document and
  `plugins: [createGfmPreset()]`
- **THEN** `editor.exportHTML()` SHALL equal
  `renderMarkdownToHtml(document, { plugins: [createGfmPreset()] })`

### Requirement: Framework Bindings Are SSR-Safe

`<Editor />` from `@floatboat/nexus-react` and `@floatboat/nexus-vue` SHALL
render only its container element when rendered to a string on the server,
and SHALL NOT access `document` or `window` during that render.

#### Scenario: React server render
- **WHEN** `renderToString(<Editor initialValue="# Hello" className="x" />)`
  runs in a Node environment without a DOM
- **THEN** the output SHALL be `<div class="x"></div>`

#### Scenario: Vue server render
- **WHEN** `renderToString(createSSRApp({ render: () => h(Editor, { initialValue: "# Hello", class: "x" }) }))`
  runs in a Node environment without a DOM
- **THEN** the output SHALL be `<div class="x"></div>`
