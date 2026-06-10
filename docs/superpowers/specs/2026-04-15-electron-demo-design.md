# Live Preview Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the first phase of `@nexus/core` live preview rendering so the current inline and block preview behavior is reliable, testable, and safe to build on.

**Architecture:** Keep live preview entirely inside `@nexus/core` and split the behavior into three clear parts: range detection, DOM rendering, and CodeMirror decoration wiring. Avoid adding new node types in this phase; instead, make the current node set predictable under document edits, cursor movement, renderer overrides, and coexistence with existing plugins.

**Tech Stack:** TypeScript, CodeMirror 6, Vitest, jsdom, mdast, unified

---

### Task 1: Extract and stabilize live preview range detection

**Files:**
- Create: `packages/core/src/live-preview-ranges.ts`
- Modify: `packages/core/src/live-preview.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/test/live-preview.test.ts`

- [x] **Step 1: Write the failing range-detection regression tests**

```ts
it("keeps image previews stable when the markdown appears after other block previews", () => {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Intro\n\n# Heading\n\n> Quote\n\n![Alt](https://example.com/image.png)",
    livePreview: true
  });

  expect(container.querySelector("[data-live-preview-image]")?.getAttribute("data-live-preview-image")).toBe(
    "https://example.com/image.png"
  );
  editor.destroy();
});

it("re-renders live preview decorations after document updates", () => {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold**",
    livePreview: true
  });

  editor.setDocument("Text **changed**");

  expect(container.querySelector("strong")?.textContent).toBe("changed");
  editor.destroy();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/live-preview.test.ts -t "keeps image previews stable|re-renders live preview decorations"`
Expected: FAIL because the current range collection mixes AST- and regex-based logic directly in one file and image handling is brittle under block content

- [x] **Step 3: Move range collection into a focused helper and use it from the view plugin**

```ts
export interface LivePreviewRange {
  from: number;
  to: number;
  node: LivePreviewNode;
  source: string;
}

export function collectLivePreviewRanges(
  ast: Root,
  doc: string,
  selection: readonly SelectionRange[]
): LivePreviewRange[] {
  const ranges: LivePreviewRange[] = [];

  visit(ast, (node) => {
    const from = node.position?.start.offset;
    const to = node.position?.end.offset;

    if (typeof from !== "number" || typeof to !== "number") {
      return;
    }

    if (!isLivePreviewNode(node) || selectionIntersects(from, to, selection)) {
      return;
    }

    ranges.push({
      from,
      to,
      node,
      source: doc.slice(from, to)
    });
  });

  ranges.push(...collectImageRanges(doc, selection));

  return ranges.sort((left, right) => left.from - right.from);
}
```

```ts
const ranges = collectLivePreviewRanges(ast, doc, view.state.selection.ranges);

for (const range of ranges) {
  builder.add(
    range.from,
    range.to,
    Decoration.replace({
      widget: createWidget(renderNode(range.node, range.source, config.renderers))
    })
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/live-preview.test.ts`
Expected: PASS with image preview and document-update live preview behavior stable

- [x] **Step 5: Commit**

```bash
git add packages/core/src/live-preview-ranges.ts packages/core/src/live-preview.ts packages/core/src/types.ts packages/core/test/live-preview.test.ts
git commit -m "refactor: stabilize live preview range detection"
```

### Task 2: Isolate default renderers and lock down renderer overrides

**Files:**
- Create: `packages/core/src/live-preview-renderers.ts`
- Modify: `packages/core/src/live-preview.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/test/live-preview.test.ts`

- [x] **Step 1: Write the failing renderer-contract tests**

```ts
it("passes the raw markdown source into custom renderers", () => {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold**",
    livePreview: {
      renderers: {
        strong({ source }) {
          const element = document.createElement("span");
          element.setAttribute("data-source", source);
          return element;
        }
      }
    }
  });

  expect(container.querySelector("[data-source]")?.getAttribute("data-source")).toBe("**bold**");
  editor.destroy();
});

it("uses default renderers for node types that are not overridden", () => {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold** *italic*",
    livePreview: {
      renderers: {
        strong({ text }) {
          const element = document.createElement("span");
          element.textContent = text.toUpperCase();
          return element;
        }
      }
    }
  });

  expect(container.querySelector("span")?.textContent).toBe("BOLD");
  expect(container.querySelector("em")?.textContent).toBe("italic");
  editor.destroy();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/live-preview.test.ts -t "passes the raw markdown source|uses default renderers"`
Expected: FAIL because renderer logic is still tightly coupled to the decoration builder and lacks a dedicated renderer module boundary

- [x] **Step 3: Split default rendering into a dedicated module**

```ts
export function createDefaultRenderer(context: LivePreviewRenderContext): HTMLElement {
  switch (context.node.type) {
    case "strong": {
      const element = document.createElement("strong");
      element.textContent = context.text;
      return element;
    }
    case "heading": {
      const element = document.createElement(`h${context.node.depth}`);
      element.textContent = context.text;
      element.style.display = "block";
      return element;
    }
    case "image": {
      const wrapper = document.createElement("span");
      wrapper.setAttribute("data-live-preview-image", context.node.url);
      wrapper.textContent = context.node.alt ?? context.node.url;
      return wrapper;
    }
  }
}
```

```ts
export function renderLivePreviewNode(
  node: LivePreviewNode,
  source: string,
  renderers: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>
): HTMLElement {
  const context: LivePreviewRenderContext = {
    node,
    nodeType: node.type,
    source,
    text: getText(node)
  };

  return renderers[node.type]?.(context) ?? createDefaultRenderer(context);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/live-preview.test.ts`
Expected: PASS with explicit renderer override behavior and default fallback behavior locked in

- [x] **Step 5: Commit**

```bash
git add packages/core/src/live-preview-renderers.ts packages/core/src/live-preview.ts packages/core/src/types.ts packages/core/test/live-preview.test.ts
git commit -m "refactor: isolate live preview renderers"
```

### Task 3: Add cursor and plugin coexistence regressions

**Files:**
- Modify: `packages/core/src/editor.ts`
- Modify: `packages/core/src/live-preview.ts`
- Create: `packages/core/test/live-preview-regressions.test.ts`

- [x] **Step 1: Write the failing coexistence tests**

```ts
it("keeps live preview working when history plugin is registered", () => {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold**",
    livePreview: true,
    plugins: [createHistoryPlugin()]
  });

  editor.setDocument("Text **changed**");

  const content = container.querySelector("[contenteditable='true']");
  content?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
  );

  expect(container.querySelector("strong")?.textContent).toBe("bold");
  editor.destroy();
});

it("restores preview after the cursor leaves a markdown range", () => {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold** end",
    livePreview: true
  });

  editor.setSelection(8);
  expect(container.querySelector("strong")).toBeNull();

  editor.setSelection(0);
  expect(container.querySelector("strong")?.textContent).toBe("bold");
  editor.destroy();
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/live-preview-regressions.test.ts`
Expected: FAIL because live preview regressions are not isolated in their own test file and cursor/plugin coexistence is not explicitly protected

- [x] **Step 3: Add regression coverage and tighten update handling**

```ts
EditorView.updateListener.of((update) => {
  if (update.docChanged || update.selectionSet) {
    scheduleLivePreviewRefresh(update.view);
  }

  if (update.docChanged) {
    scheduleChange(update.state.doc.toString());
  }
});
```

```ts
it("restores preview after the cursor leaves a markdown range", () => {
  const container = document.createElement("div");
  const editor = createEditor({
    container,
    initialValue: "Text **bold** end",
    livePreview: true
  });

  editor.setSelection(8);
  editor.setSelection(0);

  expect(container.querySelector("strong")?.textContent).toBe("bold");
  editor.destroy();
});
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/live-preview.test.ts packages/core/test/live-preview-regressions.test.ts`
Expected: PASS with stable cursor-exit behavior and plugin coexistence regressions covered

- [x] **Step 5: Commit**

```bash
git add packages/core/src/editor.ts packages/core/src/live-preview.ts packages/core/test/live-preview-regressions.test.ts
git commit -m "test: add live preview regression coverage"
```

### Task 4: Final package verification and plan close-out

**Files:**
- Modify: `docs/superpowers/plans/2026-04-15-live-preview-phase-1.md`

- [x] **Step 1: Mark this plan complete**

```md
- [x] **Step 1: Write the failing range-detection regression tests**
- [x] **Step 2: Run test to verify it fails**
- [x] **Step 3: Move range collection into a focused helper and use it from the view plugin**
- [x] **Step 4: Run test to verify it passes**
- [x] **Step 5: Commit**
```

- [x] **Step 2: Run build verification**

Run: `pnpm build`
Expected: PASS for `@nexus/core`, `@nexus/react`, `@nexus/vue`, `@nexus/preset-gfm`, `@nexus/plugin-slash`, `@nexus/plugin-history`, and `@nexus/plugin-search`

- [x] **Step 3: Run test verification**

Run: `pnpm test`
Expected: PASS with all existing package tests green and new live preview regressions included

- [x] **Step 4: Run type verification**

Run: `pnpm exec tsc --noEmit -p packages/core/tsconfig.json`
Expected: PASS with zero type errors

- [x] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-15-live-preview-phase-1.md
git commit -m "docs: mark live preview phase 1 plan complete"
```
