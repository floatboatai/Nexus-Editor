# Change: Add list item drag reorder

## Why

Roadmap / `add-missing-features` task **2.4** asks for Obsidian-style list item grip handles so hosts can reorder bullets without cut-paste. Tables already support grip drag; lists only render bullet/checkbox widgets today. Note-taking and outline hosts treat sibling reorder as a basic editing primitive.

## What Changes

- Live-preview list decorations gain a per-item grip (custom mousedown/mousemove/mouseup — no HTML5 Drag API).
- Dragging a grip reorders **sibling** list items in the Markdown source; nested children move with their parent; indentation is preserved.
- Ordered lists renumber top-level markers after a successful move.
- Interaction uses an editing lock (same idea as table grips) so CM6 does not rebuild widget DOM mid-drag.
- Pure source-transform helpers are exported for unit tests.

## Non-Goals

- Dragging to change nest level (indent / outdent).
- Cross-list moves (e.g. unordered → ordered).
- Multi-select reorder.

## Impact

- Affected specs: `live-preview` (new capability delta)
- Affected code: `packages/core/src/live-preview-list.ts` (new), `packages/core/src/live-preview.ts`, tests under `packages/core/test/`
- OpenSpec: this focused change supersedes the bare requirement in `add-missing-features` for implementation tracking
- **No breaking public API** — opt-in via existing `livePreview: true`
