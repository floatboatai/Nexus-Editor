# Slash Command Sorting + Result Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add priority-based sorting and optional result limit to slash command filtering.

**Architecture:** `SlashCommandDef` gets optional `priority` (higher = first, default 0). `filterSlashCommands` sorts by priority desc then title asc, and accepts optional `maxResults` to cap output. Both `core/src/slash-state.ts` and `plugin-slash/src/index.ts` get the change.

**Tech Stack:** TypeScript (strict), vitest

---

## File Summary

| File | Action |
|---|---|
| `packages/core/src/types.ts:156-160` | Add `priority?: number` to `SlashCommandDef` |
| `packages/core/src/slash-state.ts:30-60` | Add sort + `maxResults` to `filterSlashCommands` and `computeSlashState` |
| `packages/plugin-slash/src/index.ts:50-100` | Mirror sort + `maxResults` to its `filterSlashCommands` and `getSlashState` |
| `packages/plugin-slash/test/plugin-slash.test.ts:61-71` | Add 8 new test cases |

---

### Task 1: Add `priority` to `SlashCommandDef`

**Files:**
- Modify: `packages/core/src/types.ts:156-160`

- [ ] **Step 1: Add `priority` field**

```typescript
export interface SlashCommandDef {
  id: string;
  title: string;
  keywords?: string[];
  priority?: number;
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm -F @floatboat/nexus-core build`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add priority field to SlashCommandDef"
```

---

### Task 2: Add sort + limit to core `filterSlashCommands` and `computeSlashState`

**Files:**
- Modify: `packages/core/src/slash-state.ts:30-60`

- [ ] **Step 1: Replace `filterSlashCommands` with sorted + limited version**

Replace lines 30-41 of `packages/core/src/slash-state.ts`:

```typescript
export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string,
  maxResults?: number
): SlashCommandDef[] {
  let result: SlashCommandDef[];

  if (query === "") {
    result = commands;
  } else {
    const lower = query.toLowerCase();
    result = commands.filter((cmd) => {
      if (cmd.title.toLowerCase().includes(lower)) return true;
      return cmd.keywords?.some((kw) => kw.toLowerCase().includes(lower)) ?? false;
    });
  }

  result = [...result].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa; // higher priority first
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });

  if (maxResults !== undefined && maxResults > 0) {
    result = result.slice(0, maxResults);
  }

  return result;
}
```

- [ ] **Step 2: Update `computeSlashState` to accept and pass through `maxResults`**

Replace the function signature and body of `computeSlashState` (lines 43-60):

```typescript
export function computeSlashState(
  doc: string,
  cursor: number,
  commands: SlashCommandDef[],
  maxResults?: number
): { isOpen: boolean; from: number | null; to: number | null; query: string; commands: SlashCommandDef[] } {
  const match = getSlashMatch(doc, cursor);
  if (!match) {
    return { isOpen: false, from: null, to: null, query: "", commands: [] };
  }

  return {
    isOpen: true,
    from: match.from,
    to: match.to,
    query: match.query,
    commands: filterSlashCommands(commands, match.query, maxResults),
  };
}
```

- [ ] **Step 3: Verify editor.ts still compiles (no breakage)**

Run: `pnpm -F @floatboat/nexus-core build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/slash-state.ts
git commit -m "feat(core): add priority sort and maxResults to filterSlashCommands"
```

---

### Task 3: Mirror sort + limit in `plugin-slash`

**Files:**
- Modify: `packages/plugin-slash/src/index.ts:50-100`

- [ ] **Step 1: Replace `filterSlashCommands` in plugin-slash**

Replace lines 50-67 of `packages/plugin-slash/src/index.ts`:

```typescript
export function filterSlashCommands(
  commands: SlashCommandDef[],
  query: string,
  maxResults?: number
): SlashCommandDef[] {
  const normalizedQuery = query.trim().toLowerCase();

  let result: SlashCommandDef[];
  if (!normalizedQuery) {
    result = commands;
  } else {
    result = commands.filter((command) => {
      const haystacks = [command.title, ...(command.keywords ?? [])].map((value) =>
        value.toLowerCase()
      );
      return haystacks.some((value) => value.includes(normalizedQuery));
    });
  }

  result = [...result].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });

  if (maxResults !== undefined && maxResults > 0) {
    result = result.slice(0, maxResults);
  }

  return result;
}
```

- [ ] **Step 2: Update `getSlashState` to accept and pass through `maxResults`**

Replace the `getSlashState` function signature and body (lines 69-93):

```typescript
export function getSlashState(
  doc: string,
  cursor: number,
  commands: SlashCommandDef[],
  maxResults?: number
): SlashState {
  const match = getSlashMatch(doc, cursor);

  if (!match) {
    return {
      isOpen: false,
      from: null,
      to: null,
      query: "",
      commands: []
    };
  }

  return {
    isOpen: true,
    from: match.from,
    to: match.to,
    query: match.query,
    commands: filterSlashCommands(commands, match.query, maxResults)
  };
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm -F @floatboat/nexus-plugin-slash build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/plugin-slash/src/index.ts
git commit -m "feat(slash): add priority sort and maxResults to slash plugin"
```

---

### Task 4: Write tests for sort and limit

**Files:**
- Modify: `packages/plugin-slash/test/plugin-slash.test.ts` (append after line 71)

- [ ] **Step 1: Add test cases — priority sorting**

Append inside the existing `describe` block, after the last test at line 70:

```typescript
  it("sorts commands by priority (higher first)", () => {
    const commands = [
      { id: "a", title: "Alpha", priority: 1 },
      { id: "b", title: "Beta", priority: 3 },
      { id: "c", title: "Gamma", priority: 2 },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts same-priority commands by title alphabetically", () => {
    const commands = [
      { id: "c", title: "Charlie", priority: 1 },
      { id: "a", title: "Alpha", priority: 1 },
      { id: "b", title: "Bravo", priority: 1 },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("respects priority over title sort", () => {
    const commands = [
      { id: "z", title: "Zebra", priority: 10 },
      { id: "a", title: "Alpha", priority: 0 },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result.map((c) => c.id)).toEqual(["z", "a"]);
  });

  it("treats missing priority as 0", () => {
    const commands = [
      { id: "a", title: "Alpha" },
      { id: "b", title: "Bravo", priority: 5 },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("limits results to maxResults", () => {
    const commands = [
      { id: "a", title: "Alpha", priority: 1 },
      { id: "b", title: "Bravo", priority: 2 },
      { id: "c", title: "Charlie", priority: 3 },
    ];

    const result = filterSlashCommands(commands, "", 2);

    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["c", "b"]);
  });

  it("returns all results when maxResults is not provided", () => {
    const commands = [
      { id: "a", title: "Alpha" },
      { id: "b", title: "Bravo" },
      { id: "c", title: "Charlie" },
    ];

    const result = filterSlashCommands(commands, "");

    expect(result).toHaveLength(3);
  });

  it("sorts and limits filtered results (all three compose)", () => {
    const commands = [
      { id: "heading", title: "Heading", priority: 1 },
      { id: "table", title: "Table", priority: 3 },
      { id: "code", title: "Code Block", priority: 2 },
      { id: "link", title: "Link" },
      { id: "list", title: "List", priority: 2 },
    ];

    const result = filterSlashCommands(commands, "l", 2);

    expect(result).toHaveLength(2);
    // "l" matches: "Table" (prio 3), "Code Block" (prio 2), "Link" (prio 0), "List" (prio 2)
    // Sorted: Table(3), Code Block(2), List(2), Link(0)
    // Limited to 2: Table, Code Block
    expect(result.map((c) => c.id)).toEqual(["table", "code"]);
  });

  it("handles empty command list gracefully", () => {
    const result = filterSlashCommands([], "", 5);
    expect(result).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `pnpm -F @floatboat/nexus-plugin-slash test -- --run`
Expected: all 13 tests PASS

- [ ] **Step 3: Commit**

```bash
git add packages/plugin-slash/test/plugin-slash.test.ts
git commit -m "test(slash): add sort and limit test cases"
```

---

### Task 5: Full validation

- [ ] **Step 1: Run all tests**

```bash
pnpm test -- --run
```
Expected: no new failures (electron-demo path separator failures are pre-existing and unrelated)

- [ ] **Step 2: Build all packages**

```bash
pnpm build
```
Expected: all packages build successfully

- [ ] **Step 3: Check diff**

```bash
git diff upstream/main --stat
```
Expected: 4 files changed (types.ts, slash-state.ts, plugin-slash/index.ts, plugin-slash.test.ts)
