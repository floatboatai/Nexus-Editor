import type { List, Parent, Root } from "mdast";
import { afterEach, describe, expect, it } from "vitest";

import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createEditor } from "../src/index";
import { lezerStringToMdast } from "../src/lezer-mdast-adapter";
import {
  createListReorderChange,
  type ListItemSourceRange,
  type ListReorderChange,
} from "../src/list-reorder";

const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)]) /;

function findLists(node: Root | Parent): List[] {
  const lists: List[] = [];

  for (const child of node.children) {
    if (child.type === "list") lists.push(child);
    if ("children" in child) lists.push(...findLists(child as Parent));
  }

  return lists;
}

function rangesForList(markdown: string, list: List): ListItemSourceRange[] {
  return list.children.map((item) => {
    const from = item.position?.start.offset;
    const to = item.position?.end.offset;
    if (typeof from !== "number" || typeof to !== "number") {
      throw new Error("Expected list item source positions");
    }

    const headLineEnd = markdown.indexOf("\n", from);
    const headLine = markdown.slice(from, headLineEnd === -1 ? markdown.length : headLineEnd);
    const marker = LIST_MARKER_RE.exec(headLine);
    if (!marker) throw new Error(`Expected list marker at ${from}`);

    const markerFrom = from + marker[1].length;
    return {
      from,
      to,
      markerFrom,
      markerTo: markerFrom + marker[2].length,
    };
  });
}

function getListFixture(markdown: string, index = 0): { list: List; items: ListItemSourceRange[] } {
  const list = findLists(lezerStringToMdast(markdown))[index];
  if (!list) throw new Error(`Expected list at index ${index}`);
  return { list, items: rangesForList(markdown, list) };
}

function applyChange(markdown: string, change: ListReorderChange | null): string {
  if (!change) return markdown;
  return markdown.slice(0, change.from) + change.insert + markdown.slice(change.to);
}

function listGrips(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".nexus-list-grip"));
}

function createContainer(): HTMLDivElement {
  const container = document.createElement("div");
  container.dataset.listReorderFixture = "true";
  document.body.append(container);
  return container;
}

function dragGrip(source: HTMLElement, target: HTMLElement): void {
  source.dispatchEvent(new MouseEvent("mousedown", {
    button: 0,
    bubbles: true,
    cancelable: true,
  }));
  target.dispatchEvent(new MouseEvent("mousemove", {
    bubbles: true,
    cancelable: true,
  }));
  document.dispatchEvent(new MouseEvent("mouseup", {
    bubbles: true,
    cancelable: true,
  }));
}

afterEach(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  document.querySelectorAll("[data-list-reorder-fixture]").forEach((element) => element.remove());
});

describe("list reorder source changes", () => {
  it("moves an unordered item down using Lezer item boundaries", () => {
    const markdown = "- alpha\n- beta\n- gamma";
    const { items } = getListFixture(markdown);

    const changed = applyChange(markdown, createListReorderChange(markdown, items, 0, 2, false));

    expect(changed).toBe("- beta\n- gamma\n- alpha");
  });

  it("keeps loose-list separators in their original slots", () => {
    const markdown = "- alpha\n\n- beta\n\n- gamma";
    const { items } = getListFixture(markdown);

    const changed = applyChange(markdown, createListReorderChange(markdown, items, 2, 0, false));

    expect(changed).toBe("- gamma\n\n- alpha\n\n- beta");
  });

  it("moves a nested subtree with its parent item", () => {
    const markdown = "- parent\n  - child a\n  - child b\n- sibling";
    const { items } = getListFixture(markdown);

    const changed = applyChange(markdown, createListReorderChange(markdown, items, 0, 1, false));

    expect(changed).toBe("- sibling\n- parent\n  - child a\n  - child b");
  });

  it("preserves indentation when reordering nested siblings", () => {
    const markdown = "- parent\n  - child a\n  - child b\n- sibling";
    const { items } = getListFixture(markdown, 1);

    const changed = applyChange(markdown, createListReorderChange(markdown, items, 1, 0, false));

    expect(changed).toBe("- parent\n  - child b\n  - child a\n- sibling");
  });

  it("uses destination markers when reordering an ordered list", () => {
    const markdown = "3. alpha\n4. beta\n5. gamma";
    const { items } = getListFixture(markdown);

    const changed = applyChange(markdown, createListReorderChange(markdown, items, 2, 0, true));

    expect(changed).toBe("3. gamma\n4. alpha\n5. beta");
  });

  it("keeps all-ones ordered-list style", () => {
    const markdown = "1. alpha\n1. beta\n1. gamma";
    const { items } = getListFixture(markdown);

    const changed = applyChange(markdown, createListReorderChange(markdown, items, 0, 2, true));

    expect(changed).toBe("1. beta\n1. gamma\n1. alpha");
  });

  it("rejects stale or no-op ranges", () => {
    const markdown = "- alpha\n- beta";
    const { items } = getListFixture(markdown);
    const stale = items.map((item) => ({ ...item, to: item.to + 100 }));

    expect(createListReorderChange(markdown, items, 0, 0, false)).toBeNull();
    expect(createListReorderChange(markdown, stale, 0, 1, false)).toBeNull();
  });
});

describe("list reorder live preview", () => {
  it("renders accessible grips only for reorderable lists", () => {
    const container = createContainer();
    const editor = createEditor({
      container,
      initialValue: "intro\n\n- alpha\n- beta\n\nparagraph\n\n- alone\n\noutro",
      livePreview: true,
      locale: { reorderListItem: "Move list row" },
    });

    const grips = listGrips(container);
    expect(grips).toHaveLength(2);
    expect(grips[0].getAttribute("role")).toBe("button");
    expect(grips[0].getAttribute("aria-label")).toBe("Move list row");
    expect(grips[0].tabIndex).toBe(0);
    editor.destroy();
  });

  it("keeps grips available while the current item exposes its source marker", () => {
    const container = createContainer();
    const editor = createEditor({
      container,
      initialValue: "intro\n\n- alpha\n- beta\n\noutro",
      livePreview: true,
    });
    const before = listGrips(container).length;

    editor.setSelection("intro\n\n- al".length);

    expect(listGrips(container)).toHaveLength(before);
    editor.destroy();
  });

  it("drags a task item below a sibling and keeps its checkbox state", () => {
    const container = createContainer();
    const editor = createEditor({
      container,
      initialValue: "intro\n\n- [x] done\n- [ ] open\n- [x] later\n\noutro",
      livePreview: true,
      plugins: [createGfmPreset(), createHistoryPlugin()],
    });
    const before = editor.getDocument();
    const grips = listGrips(container);

    grips[0].dispatchEvent(new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    expect(document.activeElement).toBe(grips[0]);
    expect(grips[0].getAttribute("aria-grabbed")).toBe("true");

    grips[2].dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
    }));
    expect(grips[2].style.boxShadow).toContain("2px");

    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      cancelable: true,
    }));

    expect(editor.getDocument()).toBe(
      "intro\n\n- [ ] open\n- [x] later\n- [x] done\n\noutro"
    );
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(before);
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  it("moves an ordered item with the keyboard, preserves numbering, and restores focus", async () => {
    const container = createContainer();
    const editor = createEditor({
      container,
      initialValue: "intro\n\n1. alpha\n2. beta\n3. gamma\n\noutro",
      livePreview: true,
    });
    const grips = listGrips(container);

    grips[2].dispatchEvent(new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    }));

    expect(editor.getDocument()).toBe("intro\n\n1. alpha\n2. gamma\n3. beta\n\noutro");
    await Promise.resolve();
    expect(document.activeElement).toBe(listGrips(container)[1]);
    editor.destroy();
  });

  it("does not edit the document when a drag ends on the source item", () => {
    const container = createContainer();
    const editor = createEditor({
      container,
      initialValue: "intro\n\n- alpha\n- beta\n\noutro",
      livePreview: true,
    });
    const before = editor.getDocument();
    const [grip] = listGrips(container);

    dragGrip(grip, grip);

    expect(editor.getDocument()).toBe(before);
    editor.destroy();
  });

  it("cancels an active drag with Escape", () => {
    const container = createContainer();
    const editor = createEditor({
      container,
      initialValue: "intro\n\n- alpha\n- beta\n\noutro",
      livePreview: true,
    });
    const before = editor.getDocument();
    const grips = listGrips(container);

    grips[0].dispatchEvent(new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    grips[1].dispatchEvent(new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
    }));
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    expect(editor.getDocument()).toBe(before);
    expect(grips[0].getAttribute("aria-grabbed")).toBe("false");
    expect(document.body.style.userSelect).toBe("");
    editor.destroy();
  });

  it("cleans up an active drag when the editor is destroyed", () => {
    const container = createContainer();
    const editor = createEditor({
      container,
      initialValue: "intro\n\n- alpha\n- beta\n\noutro",
      livePreview: true,
    });
    const [grip] = listGrips(container);

    grip.dispatchEvent(new MouseEvent("mousedown", {
      button: 0,
      bubbles: true,
      cancelable: true,
    }));
    expect(document.body.style.userSelect).toBe("none");

    editor.destroy();

    expect(document.body.style.userSelect).toBe("");
    expect(document.body.style.cursor).toBe("");
  });
});
