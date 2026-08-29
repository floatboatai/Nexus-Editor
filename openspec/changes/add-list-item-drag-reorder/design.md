## Context

List live-preview currently replaces markers with bullet/checkbox widgets in `buildListDecorations`. Table row/column reorder already established the interaction rules in `CLAUDE.md` (custom drag, editing lock, no border-based indicators).

## Goals / Non-Goals

- Goals: sibling reorder via grip; preserve indent + nested children; ordered renumber; lock DOM during drag.
- Non-Goals: nest-level changes; cross-list drag; HTML5 Drag API.

## Decisions

- **Decision:** New module `live-preview-list.ts` with pure `reorderSiblingListItems` + grip widget, called from `buildListDecorations`.
- **Decision:** Custom pointer drag (mousedown/move/up), mirroring table grips — HTML5 drag is forbidden for grips.
- **Decision:** Drop target = sibling under pointer; top/bottom half chooses insert before/after ("move below" maps to bottom half / after).
- **Decision:** `isListEditing(view)` gates StateField rebuilds the same way `isTableEditing` does.
- **Alternatives considered:** ContentEditable list UI — rejected (Markdown is source of truth). HTML5 DnD — rejected (ghost image / CM6 conflicts).

## Risks / Trade-offs

- Cursor on an item reveals raw markers and skips decorations — grip hidden while editing that line (acceptable; same reveal pattern as bullets).
- Stale offsets if doc changes mid-drag — mitigated by editing lock skipping rebuilds until mouseup.
