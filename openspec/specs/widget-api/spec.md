# widget-api Specification

## Purpose

Define the public plugin widget contract for `@floatboat/nexus-core`: matching mdast nodes, rendering block/inline widgets, event ownership, edit-mode entry, lifecycle cleanup, and legacy compatibility. Widgets remain views over Markdown source ranges, keeping Markdown as the source of truth.

## Requirements

### Requirement: Register standardized widget definitions

`@floatboat/nexus-core` SHALL allow plugins to register widgets through `NexusPlugin.widgets` using the existing mdast `nodeType` and optional `match(node)` predicate, plus the standardized `display` and `eventPolicy` fields.

#### Scenario: Matching mdast node renders a widget
- **WHEN** a plugin registers a widget with `nodeType: "code"`
- **AND** the editor document contains a fenced code block outside the current selection
- **THEN** the matching source range SHALL be replaced with the widget DOM returned by `render`
- **AND** the DOM element SHALL include `data-nexus-widget="code"`

#### Scenario: Match predicate filters nodes
- **WHEN** a plugin registers a widget with `nodeType: "code"` and `match(node)` returning true only for `node.lang === "mermaid"`
- **AND** the document contains both `mermaid` and `js` fenced code blocks
- **THEN** only the `mermaid` block SHALL render as a widget
- **AND** the `js` block SHALL remain editable Markdown text

#### Scenario: Display mode controls block vs inline layout
- **WHEN** a widget definition sets `display: "inline"` for an inline mdast node
- **THEN** the widget SHALL be rendered with an inline CodeMirror replacement decoration
- **AND** surrounding text SHALL remain on the same visual line

#### Scenario: Default display mode is block
- **WHEN** a widget definition omits `display` and legacy `block`
- **THEN** the widget SHALL render as a block replacement decoration

#### Scenario: Unrecognized canonical value falls back to legacy or default
- **WHEN** a widget definition sets a `display` or `eventPolicy` value the running core does not recognize
- **THEN** the core SHALL treat the field as absent and use the legacy/default branch
- **AND** no error SHALL be thrown

#### Scenario: Event policy controls event ownership
- **WHEN** a widget definition sets `eventPolicy: "widget"`
- **THEN** the widget SHALL own DOM events inside its body via CodeMirror `ignoreEvent()`
- **AND** clicks inside the widget body SHALL NOT move the editor cursor unless the widget explicitly calls context helpers

#### Scenario: Editor event policy lets the editor handle events
- **WHEN** a widget definition sets `eventPolicy: "editor"`
- **THEN** CodeMirror SHALL receive DOM events from the widget body normally
- **AND** clicks MAY place the cursor adjacent to or inside the widget source range according to CodeMirror behavior

### Requirement: Preserve legacy widget compatibility

Existing widgets using `block`, `ignoreEvents`, `from`, `to`, `setSelection`, and `focus` SHALL continue to work without source changes.

#### Scenario: Legacy block false remains inline
- **WHEN** a widget definition omits `display` and sets `block: false`
- **THEN** the widget SHALL render as an inline replacement decoration

#### Scenario: Legacy ignoreEvents remains widget-owned
- **WHEN** a widget definition omits `eventPolicy` and sets `ignoreEvents: true`
- **THEN** the widget SHALL own DOM events inside its body via CodeMirror `ignoreEvent()`

#### Scenario: Canonical display overrides legacy block
- **WHEN** a widget definition sets both `display: "inline"` and `block: true`
- **THEN** the widget SHALL render inline

#### Scenario: Canonical event policy overrides legacy ignoreEvents
- **WHEN** a widget definition sets both `eventPolicy: "editor"` and `ignoreEvents: true`
- **THEN** CodeMirror SHALL receive DOM events from the widget body normally

#### Scenario: Legacy render context fields remain available
- **WHEN** a legacy widget render function reads `ctx.from` and calls `ctx.setSelection(ctx.from)` followed by `ctx.focus()`
- **THEN** the editor SHALL move selection into the widget source range
- **AND** the widget SHALL reveal raw Markdown for editing

### Requirement: Provide source-range render context helpers

The widget render context SHALL expose `range` and `enterEditMode` helpers for source-aware widgets.

#### Scenario: Render context exposes source range
- **WHEN** a widget render function is invoked
- **THEN** `ctx.range.from` SHALL equal the source range start offset
- **AND** `ctx.range.to` SHALL equal the source range end offset
- **AND** `ctx.range.source` SHALL equal the Markdown substring for that source range
- **AND** `ctx.from` and `ctx.to` SHALL match `ctx.range.from` and `ctx.range.to`

#### Scenario: Enter edit mode at source start
- **WHEN** a widget calls `ctx.enterEditMode()`
- **THEN** the editor selection SHALL move to the widget source range start
- **AND** the editor SHALL be focused
- **AND** the widget SHALL be replaced by raw Markdown because the selection intersects the source range

#### Scenario: Enter edit mode at source end
- **WHEN** a widget calls `ctx.enterEditMode("end")`
- **THEN** the editor selection SHALL move to the widget source range end
- **AND** the widget SHALL be replaced by raw Markdown

#### Scenario: Edit-mode entry on a shared range boundary reveals adjacent widgets
- **WHEN** `ctx.enterEditMode("start")` lands the selection on an offset shared with a preceding widget's end, or `ctx.enterEditMode("end")` lands on an offset shared with a following widget's start
- **THEN** both adjacent widgets SHALL reveal their raw Markdown, because cursor (empty-selection) intersection is inclusive at both range ends (`enterEditMode` always produces an empty selection)

### Requirement: Preserve Markdown source-of-truth behavior

Widgets SHALL remain views over Markdown source ranges, not alternate document state.

#### Scenario: Selection intersection reveals raw Markdown
- **WHEN** the editor selection intersects a widget source range
- **THEN** the widget SHALL NOT render
- **AND** the raw Markdown for that range SHALL be visible and editable

#### Scenario: Document text remains canonical
- **WHEN** a widget renders for a source range
- **THEN** `editor.getDocument()` SHALL still return the original Markdown text including that source range
- **AND** `editor.getAst()` SHALL continue to reflect the Markdown document

#### Scenario: Destroy lifecycle fires when widget is removed
- **WHEN** a rendered widget is removed because the selection enters its source range or the editor is destroyed
- **THEN** the widget definition's `destroy(element)` callback SHALL be invoked with the rendered element

#### Scenario: Multiple plugin widgets compose
- **WHEN** multiple plugins register widgets for different mdast node types
- **THEN** all matching non-overlapping source ranges SHALL render their widgets in document order

### Requirement: Provide math plugin reference migration

`@floatboat/nexus-plugin-math` SHALL use the standardized widget API fields and helpers while preserving its existing block and inline math behavior.

#### Scenario: Block math uses standardized widget ownership
- **WHEN** `@floatboat/nexus-plugin-math` renders a block math node
- **THEN** its widget definition SHALL use `display: "block"`
- **AND** SHALL use `eventPolicy: "widget"`
- **AND** its edit affordance SHALL enter raw Markdown editing through `ctx.enterEditMode()`

#### Scenario: Inline math remains inline and editor-owned
- **WHEN** `@floatboat/nexus-plugin-math` renders an inline math node
- **THEN** its widget definition SHALL use `display: "inline"`
- **AND** SHALL use `eventPolicy: "editor"`
- **AND** surrounding paragraph text SHALL remain on the same visual line

### Requirement: Document the standardized widget API

Public documentation SHALL teach the standardized widget API and identify legacy fields as compatibility aliases.

#### Scenario: Core README documents widget fields
- **WHEN** a plugin author reads `packages/core/README.md`
- **THEN** the document SHALL include an example using `display`, `eventPolicy`, and `ctx.enterEditMode`
- **AND** it SHALL mention that `block` and `ignoreEvents` are legacy-compatible aliases

#### Scenario: Top-level README plugin example uses standardized API
- **WHEN** a plugin author reads the top-level README plugin authoring example
- **THEN** the widget example SHALL use the standardized widget fields instead of legacy `block` or `ignoreEvents`

#### Scenario: Docs state the block-display whole-line constraint
- **WHEN** the documentation describes `display: "block"`
- **THEN** it SHALL state that block display is only valid for node ranges spanning whole lines, and that inline or partial-line node types must use `display: "inline"` (a block replacement decoration over a non-line-aligned range is invalid in CodeMirror)
