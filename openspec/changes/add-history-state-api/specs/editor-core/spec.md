# Spec: History state query API

## EditorAPI

### `canUndo(): boolean`

Returns `true` when there is at least one undoable step in the history stack.

- Returns `false` when no `history()` extension is registered (no-op default)
- Returns `false` after `destroy()`
- Implemented via `undoDepth(view.state) > 0`

### `canRedo(): boolean`

Returns `true` when there is at least one redoable step in the history stack.

- Returns `false` when no `history()` extension is registered
- Returns `false` after `destroy()`
- Implemented via `redoDepth(view.state) > 0`

## EditorEventMap

### `historyChange`

```typescript
historyChange: (state: { canUndo: boolean; canRedo: boolean }) => void;
```

- Emitted on every document change, but ONLY when the `canUndo` / `canRedo` boolean pair actually changed
- NOT emitted when history state is unchanged (e.g., consecutive edits that stay within the same undo group)
- NOT emitted after `destroy()`
- Guaranteed to emit BEFORE the corresponding `change` event (fires synchronously inside `updateListener`)

## Plugin: History

### `HistoryPluginOptions`

```typescript
interface HistoryPluginOptions {
  newGroupDelay?: number;  // default 500ms
  minDepth?: number;       // default 1
}
```

- `newGroupDelay`: time window (ms) during which consecutive changes merge into one undo group
- `minDepth`: minimum number of changes to combine into one undo unit
- Both passed directly to CodeMirror's `history()` facet

### Backward Compatibility

```typescript
createHistoryPlugin()  // no args — equivalent to previous behavior (default config)
```
