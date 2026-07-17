# PRD & MVP: Editor Fuzzy Search

## Background

`docs/ROADMAP.md` #17 calls for fuzzy search in the editor. The existing search experience can locate complete, contiguous text, but it cannot help when a user remembers only part of a word and the order of its characters.

This MVP extends the existing editor search panel with a focused Fuzzy mode. It does not create a second search workflow, change the editor core, add dependencies, or introduce global search state.

## Problem Statement

- Literal search cannot locate a target when the user remembers only an ordered subset of its characters.
- Fuzzy matching must show the position of each matching character and provide predictable result navigation.
- Markdown links in Live Preview are separate rendered layers, so ordinary editor highlights can be hidden by link styling.

## MVP Goals

1. Provide an explicit Fuzzy toggle in the existing search panel.
2. Match query characters in order within one alphanumeric-or-underscore token.
3. Highlight every matching character and support document-order previous/next navigation.
4. Keep existing Markdown link behavior intact while making matches inside rendered links visible.
5. Align search-panel icon controls, focus feedback, and hover labels with the existing toolbar.

## MVP Scope

### Included

- Enable and disable Fuzzy in the existing editor search panel.
- Ordered fuzzy matching within individual alphanumeric-or-underscore tokens.
- Result ranking for retention, character-level highlighting, empty-state feedback, and document-order previous/next navigation.
- Retain at most 1,000 best results to bound Decoration and navigation overhead.
- Apply temporary, plugin-scoped marker spans to visible Live Preview link text when CodeMirror Decorations are hidden by the link layer.
- Polish search-panel tooltip behavior and Electron demo header-baseline alignment.

### Excluded

- Changes to the core Live Preview link renderer or link navigation behavior.
- Third-party fuzzy-search dependencies.
- Refactors of the editor data model, persistence, or unrelated plugins.
- Fuzzy matching across whitespace or punctuation.

## User Flow

1. The user opens the existing editor search panel.
2. The user enables Fuzzy and enters a query.
3. The editor looks for query characters in order within each token.
4. Matching characters are highlighted in normal editor text and rendered link text.
5. Previous and next scroll through results in document order without moving the editor selection.
6. The panel shows an inline empty state when no result is found.
7. Closing the panel clears editor Decorations, temporary link markers, and temporary tooltip nodes.

## Technical Decisions

| Decision | Rationale |
| --- | --- |
| Keep Fuzzy state in `plugin-search` | Avoid changing the editor core lifecycle or global editor state. |
| Scan one token at a time | Prevent matches across punctuation and avoid duplicate work at token boundaries. |
| Retain the best 1,000 results | Bound memory and CodeMirror Decoration work while preserving ranked navigation. |
| Use temporary markers for rendered links | Link widgets sit above ordinary CodeMirror Decorations. Scoped markers make the rendered match visible while leaving the core link renderer and link navigation unchanged. |
| Mount tooltips as fixed-position overlays | Hover labels do not participate in toolbar layout or cause scrollbar flicker. |

## MVP Restraint

- Extend the existing search panel rather than creating another entry point or workflow.
- Keep fuzzy matching, navigation state, and link-marker cleanup inside `plugin-search`.
- Avoid changes to `packages/core`, persistent state, and third-party dependencies.
- Treat visual adjustments in the Electron demo and toolbar as supporting consistency work only; they do not alter editor behavior.

## Acceptance Criteria

- A Fuzzy query highlights matching characters only within a token.
- Previous and next navigate results in document order.
- Matches inside Markdown links remain visible.
- Closing the panel clears fuzzy and link-highlight styles.
- Search tooltips do not alter toolbar or panel overflow layout.
- `pnpm test`, `pnpm typecheck`, `pnpm build`, and `pnpm build:electron-demo` pass.
