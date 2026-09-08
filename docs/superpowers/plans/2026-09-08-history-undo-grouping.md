# History Undo/Redo Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@floatboat/nexus-plugin-history` with configurable CM6 history options (`newGroupDelay`, `minDepth`) and explicit `isolateHistory` helpers (`runInHistoryGroup`, `withIsolatedHistory`) without changing default undo behavior.

**Architecture:** Keep all logic inside `packages/plugin-history`. Pass options through to `history(config)`. Implement thin helpers on top of CodeMirror’s `isolateHistory` annotation. Do not modify `packages/core` or table widgets. Prove behavior with Vitest using `EditorView.findFromDOM` and `editor.undo()`.

**Tech Stack:** TypeScript, Vitest, CodeMirror 6 (`@codemirror/commands`, `@codemirror/view`, `@codemirror/state`), `@floatboat/nexus-core`

## Global Constraints

- Zero-argument `createHistoryPlugin()` MUST behave like today’s plugin (CM6 default history config).
- Public options are only `newGroupDelay` and `minDepth` (no `joinToEvent` in this PR).
- `runInHistoryGroup` guarantees **boundary isolation**, not “N dispatches → exactly one undo entry”.
- Do not edit `live-preview-table.ts` or core undo/redo.
- Spec: `docs/superpowers/specs/2026-09-08-history-undo-grouping-design.md`.

## File map

| File | Responsibility |
|---|---|
| `packages/plugin-history/src/history-group.ts` | `runInHistoryGroup`, `withIsolatedHistory` |
| `packages/plugin-history/src/index.ts` | `HistoryPluginOptions`, `createHistoryPlugin`, re-exports |
| `packages/plugin-history/test/plugin-history.test.ts` | Regression + options + isolation tests |
| `packages/plugin-history/package.json` | Add `@codemirror/state` dependency if needed for types |
| `packages/plugin-history/README.md` | Short usage notes (create if missing) |
| `docs/ROADMAP.zh.md` / `docs/ROADMAP.md` | Mark item #8 `in-progress` then `done` at PR end |

---

### Task 1: Failing tests for options + isolation helpers

**Files:**
- Modify: `packages/plugin-history/test/plugin-history.test.ts`
- Create (later in Task 2): `packages/plugin-history/src/history-group.ts`
- Modify (later in Task 2): `packages/plugin-history/src/index.ts`

**Interfaces:**
- Consumes: `createEditor` from `@floatboat/nexus-core`; `EditorView` from `@codemirror/view`
- Produces (expected exports after Task 2):
  - `HistoryPluginOptions`
  - `createHistoryPlugin(options?: HistoryPluginOptions): NexusPlugin`
  - `withIsolatedHistory(spec: TransactionSpec, mode?: "before" | "after" | "full"): TransactionSpec`
  - `runInHistoryGroup(view: EditorView, fn: (view: EditorView) => void): void`
  - `isolateHistory` re-export

- [ ] **Step 1: Extend the test file with imports and three new cases**

Replace / append in `packages/plugin-history/test/plugin-history.test.ts` so the file includes the existing two tests **plus**:

```ts
import { createEditor } from "@floatboat/nexus-core";
import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { describe, expect, it } from "vitest";
import {
  createHistoryPlugin,
  runInHistoryGroup,
  withIsolatedHistory
} from "../src/index";

describe("@floatboat/nexus-plugin-history", () => {
  // --- keep existing undo / redo keymap tests unchanged ---

  it("accepts history options without changing default undo", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin({ newGroupDelay: 50, minDepth: 20 })]
    });

    editor.setDocument("next");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("start");
    editor.destroy();
  });

  it("withIsolatedHistory attaches isolateHistory annotation", () => {
    const spec = withIsolatedHistory(
      { changes: { from: 0, to: 0, insert: "x" } },
      "before"
    );
    const annotations = Array.isArray(spec.annotations)
      ? spec.annotations
      : spec.annotations
        ? [spec.annotations]
        : [];
    expect(annotations.some((a) => a.type === isolateHistory && a.value === "before")).toBe(
      true
    );
  });

  it("runInHistoryGroup isolates grouped edits from surrounding history", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "base",
      plugins: [createHistoryPlugin({ newGroupDelay: 10_000 })]
    });

    const view = EditorView.findFromDOM(container);
    expect(view).toBeTruthy();
    if (!view) return;

    view.dispatch({
      changes: { from: 4, insert: "A" },
      userEvent: "input.type"
    });

    runInHistoryGroup(view, (v) => {
      v.dispatch({
        changes: { from: 5, insert: "B" },
        userEvent: "input.type"
      });
    });

    view.dispatch({
      changes: { from: 6, insert: "C" },
      userEvent: "input.type"
    });

    expect(editor.getDocument()).toBe("baseABC");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("baseAB");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("baseA");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("base");

    editor.destroy();
  });
});
```

- [ ] **Step 2: Run tests to verify new cases fail**

Run:

```bash
pnpm exec vitest run packages/plugin-history/test/plugin-history.test.ts
```

Expected: FAIL — `runInHistoryGroup` / `withIsolatedHistory` not exported (and/or options overload missing). Existing keymap tests may still pass.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/plugin-history/test/plugin-history.test.ts
git commit -m "test(plugin-history): add failing coverage for history grouping API"
```

---

### Task 2: Implement options + grouping helpers

**Files:**
- Create: `packages/plugin-history/src/history-group.ts`
- Modify: `packages/plugin-history/src/index.ts`
- Modify: `packages/plugin-history/package.json` (add `@codemirror/state` if TypeScript cannot resolve `TransactionSpec`)

**Interfaces:**
- Consumes: `history`, `historyKeymap`, `isolateHistory` from `@codemirror/commands`; `keymap`, `EditorView` from `@codemirror/view`; `TransactionSpec` from `@codemirror/state`; `NexusPlugin` from `@floatboat/nexus-core`
- Produces: public API listed in Task 1

- [ ] **Step 1: Add `@codemirror/state` dependency**

In `packages/plugin-history/package.json`, add alongside existing deps:

```json
"@codemirror/state": "^6.5.2"
```

Use the same major/minor range as `packages/plugin-toolbar/package.json`. Then run `pnpm install` from repo root.

- [ ] **Step 2: Implement `history-group.ts`**

Create `packages/plugin-history/src/history-group.ts`:

```ts
import { isolateHistory } from "@codemirror/commands";
import type { TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type IsolateHistoryMode = "before" | "after" | "full";

export function withIsolatedHistory(
  spec: TransactionSpec,
  mode: IsolateHistoryMode = "full"
): TransactionSpec {
  const annotation = isolateHistory.of(mode);
  const existing = spec.annotations;
  if (!existing) {
    return { ...spec, annotations: annotation };
  }
  if (Array.isArray(existing)) {
    return { ...spec, annotations: [...existing, annotation] };
  }
  return { ...spec, annotations: [existing, annotation] };
}

/**
 * Run `fn` so its dispatches are isolated from history events before/after
 * the group. Edits inside the group still follow CM6 join rules relative
 * to each other.
 */
export function runInHistoryGroup(
  view: EditorView,
  fn: (view: EditorView) => void
): void {
  view.dispatch({ annotations: isolateHistory.of("before") });
  try {
    fn(view);
  } finally {
    view.dispatch({ annotations: isolateHistory.of("after") });
  }
}
```

- [ ] **Step 3: Wire `createHistoryPlugin` options and exports in `index.ts`**

Replace `packages/plugin-history/src/index.ts` with:

```ts
import { history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { keymap } from "@codemirror/view";

import type { NexusPlugin } from "@floatboat/nexus-core";

import {
  runInHistoryGroup,
  withIsolatedHistory,
  type IsolateHistoryMode
} from "./history-group";

export interface HistoryPluginOptions {
  /** Max ms between adjacent events that may still merge. CM6 default: 500 */
  newGroupDelay?: number;
  /** Minimum history depth. CM6 default: 100 */
  minDepth?: number;
}

export function createHistoryPlugin(options: HistoryPluginOptions = {}): NexusPlugin {
  const config =
    options.newGroupDelay === undefined && options.minDepth === undefined
      ? undefined
      : {
          ...(options.newGroupDelay !== undefined
            ? { newGroupDelay: options.newGroupDelay }
            : {}),
          ...(options.minDepth !== undefined ? { minDepth: options.minDepth } : {})
        };

  return {
    name: "plugin-history",
    cmExtensions: [history(config), keymap.of(historyKeymap)]
  };
}

export {
  isolateHistory,
  runInHistoryGroup,
  withIsolatedHistory,
  type IsolateHistoryMode
};
```

Note: `history(undefined)` and `history()` are equivalent in CM6; passing `undefined` keeps default behavior for zero-config callers.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm exec vitest run packages/plugin-history/test/plugin-history.test.ts
```

Expected: all tests PASS.

If `withIsolatedHistory` annotation assertion fails because Annotation identity differs, switch that test to a behavioral check: dispatch `withIsolatedHistory(...)` between two adjacent inserts with large `newGroupDelay` and assert two undos are required (same idea as the group test).

- [ ] **Step 5: Commit implementation**

```bash
git add packages/plugin-history/src/history-group.ts packages/plugin-history/src/index.ts packages/plugin-history/package.json pnpm-lock.yaml
git commit -m "feat(plugin-history): add history options and isolateHistory helpers"
```

---

### Task 3: Docs + roadmap + package build check

**Files:**
- Create: `packages/plugin-history/README.md`
- Modify: `docs/ROADMAP.zh.md` (item #8 status)
- Modify: `docs/ROADMAP.md` if the English table mirrors item #8

**Interfaces:**
- Consumes: public API from Task 2
- Produces: documented usage for hosts

- [ ] **Step 1: Add package README**

Create `packages/plugin-history/README.md`:

```md
# @floatboat/nexus-plugin-history

CodeMirror 6 undo/redo for Nexus Editor.

## Usage

```ts
import {
  createHistoryPlugin,
  runInHistoryGroup,
  withIsolatedHistory
} from "@floatboat/nexus-plugin-history";
import { EditorView } from "@codemirror/view";

// Default (CM6 built-in grouping)
createHistoryPlugin();

// Tune merge window / depth
createHistoryPlugin({ newGroupDelay: 500, minDepth: 100 });

// Isolate a batch of dispatches from surrounding history
runInHistoryGroup(view, (v) => {
  v.dispatch({ changes: { from: 0, insert: "Hello" } });
});

// Annotate a single transaction
view.dispatch(withIsolatedHistory({ changes: { from: 0, insert: "!" } }, "full"));
```

`runInHistoryGroup` isolates the group from edits before/after it. It does **not** force multiple inner dispatches into a single undo entry — use one `dispatch` / `replaceRange` when you need a single Ctrl+Z.
```

- [ ] **Step 2: Update roadmap status for item #8**

In `docs/ROADMAP.zh.md` (and English twin if present), set undo/redo 分组 row status from `planned` to `done` (or `in-progress` until the PR merges — prefer `done` only in the merge commit / final PR commit).

- [ ] **Step 3: Build the package**

Run:

```bash
pnpm --filter @floatboat/nexus-plugin-history build
```

Expected: exit 0; `dist/index.js` and `dist/index.d.ts` emit the new exports.

- [ ] **Step 4: Commit docs**

```bash
git add packages/plugin-history/README.md docs/ROADMAP.zh.md docs/ROADMAP.md
git commit -m "docs(plugin-history): document history grouping API and mark roadmap #8"
```

---

### Task 4: Final verification and PR prep

**Files:**
- None required beyond clean tree

- [ ] **Step 1: Re-run focused tests + build**

```bash
pnpm exec vitest run packages/plugin-history/test/plugin-history.test.ts
pnpm --filter @floatboat/nexus-plugin-history build
```

Expected: PASS / exit 0.

- [ ] **Step 2: Draft PR summary (for the human)**

Title: `feat(plugin-history): configurable history grouping and isolate helpers`

Body bullets:
- Add `HistoryPluginOptions` (`newGroupDelay`, `minDepth`)
- Add `runInHistoryGroup` / `withIsolatedHistory` / re-export `isolateHistory`
- Tests for options + isolation boundaries
- Non-goals: table `tableEditingCount` coordination, core history rewrite

- [ ] **Step 3: Stop for human review before opening the PR**

Do not push or open the PR unless the user asks. Present the branch diff summary and wait.

---

## Spec coverage self-check

| Spec requirement | Task |
|---|---|
| `HistoryPluginOptions` + pass-through to `history()` | Task 2 |
| Zero-arg default unchanged | Task 1 + 2 (`history(undefined)` / empty config) |
| `runInHistoryGroup` + try/finally after-isolate | Task 2 |
| `withIsolatedHistory` | Task 2 |
| Re-export `isolateHistory` | Task 2 |
| Vitest coverage | Task 1 |
| README / JSDoc | Task 3 |
| Roadmap #8 | Task 3 |
| Table coordination out of scope | Global Constraints + PR notes (Task 4) |
| No core / table edits | Global Constraints |

## Placeholder scan

No TBD / “implement later” steps. Commands and code are concrete. Annotation assertion has a documented fallback if CM6 Annotation identity differs in the test environment.
