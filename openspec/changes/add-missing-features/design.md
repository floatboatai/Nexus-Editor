# Design: Add missing features

## Architecture Decisions

### Theme System

Use CSS custom properties (`--nexus-bg`, `--nexus-text`, `--nexus-code-bg`, etc.) set on the editor root element. All internal styles reference these variables. The `NexusTheme` interface maps semantic names to color values. CM6's `EditorView.theme()` is used for editor-level theming; widget styles read from CSS variables.

**Rationale:** CSS custom properties allow runtime switching without DOM recreation. CM6 themes are compartments that can be reconfigured.

### Internationalization

Extend the existing `LivePreviewLabels` pattern to a full `NexusLocale` interface covering all user-visible strings. The locale is passed through `EditorConfig` and propagated to all widgets and decorations via the existing config normalization pattern.

**Rationale:** The labels API already exists for table buttons. Extending it is incremental, not a rewrite.

### Markdown Auto-Continuation

Implement as a CM6 `keymap` extension that intercepts Enter. Check the current line's content for list markers (`- `, `* `, `1. `, `> `) and insert the appropriate prefix on the new line. Empty markers are removed (exit the structure).

**Rationale:** This is a standard CM6 keymap pattern. No AST parsing needed — simple regex matching on the current line.

### Folding

Use CM6's built-in `foldGutter()` and `foldService()`. Provide a custom fold service that:
- For headings: folds from heading line to the line before the next same-or-higher-level heading
- For code blocks: folds from opening fence to closing fence

**Rationale:** CM6 has built-in fold infrastructure. We only need to define fold ranges.

### Mermaid Plugin

Follow the same pattern as `@floatboat/nexus-plugin-math`: register a `WidgetDefinition` for `code` nodes where `lang === "mermaid"`. The widget renders SVG via `mermaid.render()`. Lazy-load mermaid.js to avoid bundle bloat.

**Rationale:** Consistent with existing plugin architecture. Widget API already supports this pattern.

### Nested Inline Formatting

Walk the AST children recursively to calculate the actual marker text from the source. For `***bold italic***`:
- The AST has `emphasis` > `strong` > text, or `strong` > `emphasis` > text
- Calculate marker positions from the difference between parent and child `position.start/end.offset`

**Rationale:** The current `getInlineMarkerStyle` hardcodes marker lengths. Recursive AST walking gives accurate positions for any nesting depth.

## Performance Considerations

- Theme switching: O(1) — just update CSS variables
- Locale switching: requires decoration rebuild — acceptable since it's infrequent
- Folding: CM6 handles fold state incrementally — no performance concern
- Mermaid rendering: async, render on worker thread if available
- Auto-continuation: O(1) per keystroke — simple regex on current line

## Migration

No breaking changes. All new features are additive:
- `theme` is an optional new config property
- `locale` is an optional new config property
- New API methods (`getTableOfContents`, `exportHTML`, `setTheme`) are additions
- New plugins are separate packages
- Folding and auto-continuation are opt-in extensions
