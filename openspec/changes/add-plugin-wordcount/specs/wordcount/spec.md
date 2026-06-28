# Word Count Spec — Markdown-aware document statistics

## ADDED Requirements

### Requirement: Markdown-Aware Counting Function

The package SHALL export `countMarkdown(source: string, options?:
WordCountOptions): WordCountStats`. The function SHALL traverse a
parsed mdast tree of the source, collect only "prose text" segments,
and compute a structured statistics record. The function SHALL never
throw — on parse failure it SHALL fall back to a naive whitespace
counter and return a populated `WordCountStats`.

Default node-type exclusions are `code`, `inlineCode`, `math`,
`inlineMath`, `html`, `yaml`, `toml`, `definition`,
`footnoteDefinition`. Image alt text is included by default.

#### Scenario: Plain English prose
- **WHEN** `countMarkdown("Hello, World!")` is invoked
- **THEN** the result SHALL satisfy `words === 2`,
  `characters === 13`, `charactersNoSpaces === 12`,
  `sentences === 1`, `paragraphs === 1`, and
  `readingTimeSeconds >= 1`

#### Scenario: Fenced code blocks are excluded
- **WHEN** the source is `"text\n\n\`\`\`js\nconst x = 1;\n\`\`\`\n"`
- **THEN** the result SHALL satisfy `words === 1`
- **AND** the code block characters SHALL NOT contribute to
  `charactersNoSpaces`

#### Scenario: Inline code is excluded
- **WHEN** the source is `` "`abc def` ghi" ``
- **THEN** `words` SHALL equal `1`

#### Scenario: YAML frontmatter is excluded
- **WHEN** the source begins with `---\ntitle: foo\n---\nhello`
- **THEN** `words` SHALL equal `1`

#### Scenario: HTML blocks and comments are excluded
- **WHEN** the source is `"<!-- private --> hello world"`
- **THEN** `words` SHALL equal `2`

#### Scenario: Math is excluded by default
- **WHEN** the source contains `$x^2$ done` or `$$x = 1$$\nDone`
- **THEN** `words` SHALL equal `1` for each case

#### Scenario: Image alt text counts by default
- **WHEN** the source is `"![a sleepy cat](cat.png)"`
- **THEN** `words` SHALL equal `3`
- **AND** invoking with `{ exclude: ["image"] }` SHALL yield
  `words === 0`

#### Scenario: Empty document
- **WHEN** `countMarkdown("")` is invoked
- **THEN** every numeric field SHALL equal `0`

#### Scenario: Invalid input does not throw
- **WHEN** `countMarkdown(arbitraryGarbage)` is invoked with any
  string value
- **THEN** the function SHALL return a fully-populated
  `WordCountStats` and SHALL NOT throw

### Requirement: CJK Counting

CJK ideographs and syllables SHALL be counted per character by
default (`cjkUnit: "char"`), including `\p{Script=Han}`,
`\p{Script=Hiragana}`, `\p{Script=Katakana}`, and
`\p{Script=Hangul}`.
Setting `cjkUnit: "word"` SHALL collapse consecutive same-script
runs into a single word. The `cjkCharacters` field SHALL always
report the total raw CJK character count regardless of `cjkUnit`.

#### Scenario: Default per-character counting
- **WHEN** `countMarkdown("你好，世界。")` is invoked
- **THEN** `words` SHALL equal `4`
- **AND** `cjkCharacters` SHALL equal `4`
- **AND** `sentences` SHALL equal `1`

#### Scenario: Run-collapse mode
- **WHEN** `countMarkdown("你好世界", { cjkUnit: "word" })` is invoked
- **THEN** `words` SHALL equal `1`
- **AND** `cjkCharacters` SHALL equal `4`

#### Scenario: Mixed Latin and CJK
- **WHEN** `countMarkdown("Hello 世界 today")` is invoked
- **THEN** `words` SHALL equal `4`
- **AND** `latinWords` SHALL equal `2`
- **AND** `cjkCharacters` SHALL equal `2`

### Requirement: Reading-Time Estimation

`readingTimeSeconds` SHALL be computed as
`ceil(latinWords / wpm * 60 + cjkCharacters / cpm * 60)` with default
`wpm = 238` and `cpm = 500`, both overridable via
`options.readingSpeed`.

#### Scenario: Minimum visible reading time
- **WHEN** a single short word is counted
- **THEN** `readingTimeSeconds` SHALL be at least `1`

#### Scenario: Override defaults
- **WHEN** `countMarkdown(source, { readingSpeed: { wpm: 100 } })`
  is invoked on a 100-Latin-word document
- **THEN** `readingTimeSeconds` SHALL equal `60`

#### Scenario: Latin and CJK rates combine
- **WHEN** the source has 100 Latin words and 500 CJK characters and
  defaults apply
- **THEN** `readingTimeSeconds` SHALL equal
  `Math.ceil(100/238*60 + 500/500*60)` exactly

### Requirement: Plugin Factory and Lifecycle

The package SHALL export `createWordCountPlugin(options?:
WordCountPluginOptions): NexusPlugin & WordCountAPI` where
`WordCountAPI = { getStats(), getSelectionStats(), subscribe(listener),
destroy() }`. The returned object SHALL be a valid `NexusPlugin`
(passing the runtime contract of `@floatboat/nexus-core`'s plugin
registration).

When the editor mounts the plugin, a `change` listener SHALL be
attached and a `selectionChange` listener SHALL be attached on the
public `editor.on` API. Full-document recompute SHALL be debounced
by `options.debounceMs` (default `150`). Selection recompute SHALL
run synchronously.

#### Scenario: Initial stats are available without an edit
- **WHEN** an editor is created with
  `plugins: [createWordCountPlugin()]` and initial value
  `"Hello world"`
- **THEN** `plugin.getStats()` SHALL return stats with `words === 2`
  on the next microtask

#### Scenario: Subscribe fires immediately
- **WHEN** `plugin.subscribe(listener)` is invoked after the
  editor has mounted
- **THEN** `listener` SHALL be invoked exactly once with the current
  `{ doc, selection, isSelectionActive }` state before the call
  returns to the caller's next statement

#### Scenario: Document edits trigger debounced recompute
- **WHEN** the editor receives a series of three `setDocument` calls
  inside `options.debounceMs`
- **THEN** the subscribed listener SHALL be invoked at most twice:
  once on initial attach and once after the debounce window with the
  latest stats

#### Scenario: Selection updates are synchronous
- **WHEN** the editor's selection moves from collapsed to a
  multi-character range
- **THEN** the subscribed listener SHALL be invoked synchronously
  with `isSelectionActive === true`
- **AND** `selection.words` SHALL reflect the slice's word count

#### Scenario: Destroy stops further updates
- **WHEN** `plugin.destroy()` has been called
- **AND** the editor subsequently dispatches further changes
- **THEN** the subscribed listener SHALL NOT be invoked again

### Requirement: Status-Bar Widget

The package SHALL export `createStatusBar(editor, plugin, options?:
StatusBarOptions): StatusBarHandle` and SHALL also accept a
`statusBar: false | StatusBarOptions` field on `createWordCountPlugin`
as a convenience. The bar SHALL render as a single element with
`role="status"` and `aria-live="polite"`. It SHALL display word
count, character count, and reading time; a selection summary span
SHALL appear when a selection is active.

#### Scenario: Mount and unmount
- **WHEN** the bar is created
- **THEN** it SHALL be attached to the document under the configured
  container
- **AND** `StatusBarHandle.destroy()` SHALL remove the element and
  unsubscribe from the plugin

#### Scenario: Updates reflect plugin state
- **WHEN** the editor's document changes and the recompute fires
- **THEN** the bar's word count, character count, and reading-time
  text SHALL update to match `plugin.getStats()`

#### Scenario: Selection summary visibility
- **WHEN** the selection is empty
- **THEN** the selection summary span SHALL be hidden (or have
  `aria-hidden="true"` and `display: none`)
- **AND** when a selection is active the span SHALL be visible with
  text matching `plugin.getSelectionStats()`

#### Scenario: ARIA live region announces changes
- **WHEN** the bar updates
- **THEN** the bar root element SHALL have `aria-live="polite"`
- **AND** the bar root element SHALL have `role="status"`

### Requirement: Internationalised Labels

The plugin and the status bar SHALL accept a `labels?:
Partial<WordCountLabels>` option that overrides every visible string
(default English; documentation example provides Chinese). Strings
omitted SHALL fall back to the English defaults.

#### Scenario: Chinese localisation
- **WHEN** the plugin is created with
  `labels: { words: "字", characters: "字符", readingTime: "分钟阅读" }`
- **THEN** the rendered status bar SHALL use the Chinese labels for
  the relevant fields
- **AND** unsupplied label keys SHALL still render in English

### Requirement: No Re-Parsing of the Document

Mounted plugin full-document recomputes SHALL consume the AST returned
by `editor.getAst()` and SHALL NOT construct a unified pipeline. The
lazy pipeline SHALL only be constructed when `countMarkdown` is called
without an `ast` option or on a selection slice.

#### Scenario: AST is reused for full doc
- **WHEN** the editor dispatches a `change` and the plugin's
  recompute runs
- **THEN** the recompute SHALL receive the same `Root` reference as
  `editor.getAst()`
- **AND** no `unified()` factory call SHALL occur on the full-doc
  path
