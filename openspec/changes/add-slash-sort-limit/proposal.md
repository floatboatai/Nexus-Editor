# Slash Command Sorting + Result Limit

**Roadmap:** P0 #3
**Package:** `core` + `plugin-slash`
**Status:** draft

## Why

Currently slash commands appear in plugin-registration order with no sorting or limit — plugins that register first dominate the menu regardless of relevance. Adding priority-based sorting and an optional result cap makes the slash menu work for real-world use cases with dozens of commands.

## What Changes

- `SlashCommandDef` gets optional `priority: number` (higher = first, default 0)
- `filterSlashCommands()` sorts results by priority desc, then title asc
- `filterSlashCommands()` and `computeSlashState()` accept optional `maxResults` to cap output
- `plugin-slash` mirrors the core changes

## API

### Type change (`types.ts`)

```typescript
export interface SlashCommandDef {
  id: string;
  title: string;
  keywords?: string[];
  priority?: number;  // NEW: default 0, higher = first
}
```

### Function signatures (`slash-state.ts`)

```typescript
export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string,
  maxResults?: number
): SlashCommandDef[]

export function computeSlashState(
  doc: string,
  cursor: number,
  commands: SlashCommandDef[],
  maxResults?: number
): { isOpen: boolean; from: number | null; to: number | null; query: string; commands: SlashCommandDef[] }
```

### Sort order

1. `priority` descending (8 before 3 before 0)
2. Same priority → `title` case-insensitive ascending ("Add" before "Bold" before "Copy")

### Limit behavior

- `maxResults` omitted → all matching results returned (backwards-compatible)
- `maxResults: N` → first N commands after filtering + sorting

## Files affected

| File | Change |
|---|---|
| `packages/core/src/types.ts` | Add `priority?: number` to `SlashCommandDef` |
| `packages/core/src/slash-state.ts` | Add sort logic + `maxResults` param |
| `packages/core/src/editor.ts` | Pass `maxResults` through (no behavior change when unset) |
| `packages/plugin-slash/src/index.ts` | Mirror core sort/limit logic |

## Test plan

| # | Scenario |
|---|---|
| 1 | Commands sort by priority desc |
| 2 | Same priority → sort by title asc (case-insensitive) |
| 3 | Mixed: priority takes precedence over title |
| 4 | maxResults limits output count |
| 5 | No maxResults → all results returned |
| 6 | Empty command list → empty result |
| 7 | Default priority 0 when not set |
| 8 | filter + sort + limit, all three compose |
