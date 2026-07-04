# OpenSpec: add-plugin-mention

## Summary

Introduce `@floatboat/nexus-plugin-mention`, a headless mention plugin that lets users type `@` to search and insert person/entity references into Markdown documents.

## Motivation

- Roadmap item #20 (shared comments / @mention) requires a foundational mention system.
- AI/LLM applications increasingly need @-agent references (e.g. "@GPT-4 summarize this").
- Existing Markdown editors lack a headless, AST-driven mention solution that preserves round-trip safety.

## Design

### Markdown Syntax

`[@Display Name](entity-id)` — a standard Markdown link with a convention that the plugin recognizes and elevates to a first-class `mention` mdast node.

### Architecture

```
User types "@" → CM6 ViewPlugin detects trigger → debounced query → floating menu
                                                                      ↓
User selects item → insert `[@name](id)` text → remarkMention parses → mention node
                                                                      ↓
Cursor leaves range → live-preview widget renders chip → click chip → enter edit mode
```

### API Surface

- `createMentionPlugin(config)` — main factory
- `remarkMention` — remark plugin for AST
- `createMentionWidgetDefinition(options)` — widget factory
- Event: `mentionMenuChange` — emitted on editor bus

### A11y

- `role="listbox"` / `role="option"`
- `aria-selected`, `aria-activedescendant`
- Keyboard-only workflow fully supported

## Scope

| Package | Change |
|---------|--------|
| `plugin-mention` | New package (this PR) |
| `core` | None — uses existing plugin API |
| `react` / `vue` | None — works through existing `<Editor />` |
| `electron-demo` | Optional integration in follow-up |

## Backwards Compatibility

Fully additive. No breaking changes to existing packages.

## Test Plan

- Unit: AST parse/stringify round-trip, menu DOM construction, selection updates
- Integration: CM6 ViewPlugin lifecycle, keyboard event handling
- Manual: electron-demo with mock query function

## Timeline

Single PR. No follow-up required for core functionality.
