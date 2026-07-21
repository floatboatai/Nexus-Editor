# Change: Anchor table column grips to their header cells

## Why

The live-preview table widget renders column drag grips in a standalone table row. That row does not share the content column geometry after width changes, which can visually misalign a grip from the column it selects or reorders. The table-widget rules require a grip to be positioned relative to its header cell instead.

## What Changes

- Render each column grip inside its corresponding header cell and remove the standalone grip row.
- Preserve existing column selection, custom mouse drag/reorder, resize handles, row grips, and keyboard deletion behavior.
- Replace DOM-row-index assumptions that depended on the standalone row with semantic header/body queries.
- Add regression coverage for the header ownership and the affected interaction paths.

## Impact

- Affected spec: `live-preview`
- Affected code: `packages/core/src/live-preview-table.ts`, `packages/core/test/live-preview.test.ts`
- Public API, dependencies, and Markdown serialization: unchanged.
