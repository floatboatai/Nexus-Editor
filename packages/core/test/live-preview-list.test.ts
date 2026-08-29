import { describe, expect, it } from "vitest";
import {
  applyListItemReorder,
  detectListBaseIndent,
  dropIndexAfterRemoval,
  renumberOrderedListRegion,
  reorderSiblingListItems,
  type ListItemSpan
} from "../src/live-preview-list";

describe("reorderSiblingListItems", () => {
  const doc = "- a\n- b\n- c\n";
  const items: ListItemSpan[] = [
    { from: 0, to: 4 },
    { from: 4, to: 8 },
    { from: 8, to: 12 }
  ];

  it("moves the first item below the second", () => {
    // A below B → B A C
    const toIndex = dropIndexAfterRemoval(0, 1, true);
    expect(toIndex).toBe(1);
    expect(reorderSiblingListItems(doc, items, 0, toIndex)).toBe("- b\n- a\n- c\n");
  });

  it("moves the last item to the front", () => {
    const toIndex = dropIndexAfterRemoval(2, 0, false);
    expect(toIndex).toBe(0);
    expect(reorderSiblingListItems(doc, items, 2, toIndex)).toBe("- c\n- a\n- b\n");
  });

  it("is a no-op when indices match", () => {
    expect(reorderSiblingListItems(doc, items, 1, 1)).toBe(doc);
  });
});

describe("nested list item blocks", () => {
  // - a
  //   - a1
  //   - a2
  // - b
  const doc = "- a\n  - a1\n  - a2\n- b\n";
  const items: ListItemSpan[] = [
    { from: 0, to: 18 }, // through end of a2 line's newline before b? 
    { from: 18, to: 22 }
  ];

  it("keeps nested children with the parent when reordering", () => {
    // Verify fixture spans: slice join equals region
    expect(doc.slice(items[0].from, items[1].from) + doc.slice(items[1].from, items[1].to)).toBe(
      doc.slice(items[0].from, items[1].to)
    );

    const toIndex = dropIndexAfterRemoval(0, 1, true);
    const next = reorderSiblingListItems(doc, items, 0, toIndex);
    expect(next).toBe("- b\n- a\n  - a1\n  - a2\n");
  });
});

describe("renumberOrderedListRegion", () => {
  it("renumbers top-level markers and leaves nested unordered alone", () => {
    const region = "3. first\n   - nest\n1. second\n2. third\n";
    expect(renumberOrderedListRegion(region, "", 1)).toBe(
      "1. first\n   - nest\n2. second\n3. third\n"
    );
  });

  it("respects base indent for nested ordered siblings", () => {
    const region = "   2. x\n   9. y\n";
    expect(renumberOrderedListRegion(region, "   ", 1)).toBe("   1. x\n   2. y\n");
  });
});

describe("applyListItemReorder", () => {
  it("reorders ordered lists and renumbers markers", () => {
    const doc = "1. a\n2. b\n3. c\n";
    const items: ListItemSpan[] = [
      { from: 0, to: 5 },
      { from: 5, to: 10 },
      { from: 10, to: 15 }
    ];
    const toIndex = dropIndexAfterRemoval(2, 0, false);
    const next = applyListItemReorder(doc, items, 2, toIndex, {
      ordered: true,
      startNum: 1
    });
    expect(next).toBe("1. c\n2. a\n3. b\n");
  });

  it("preserves task-list markers when reordering", () => {
    const doc = "- [ ] a\n- [x] b\n- [ ] c\n";
    const items: ListItemSpan[] = [
      { from: 0, to: 8 },
      { from: 8, to: 16 },
      { from: 16, to: 24 }
    ];
    const toIndex = dropIndexAfterRemoval(0, 1, true);
    const next = applyListItemReorder(doc, items, 0, toIndex);
    expect(next).toBe("- [x] b\n- [ ] a\n- [ ] c\n");
  });
});

describe("detectListBaseIndent", () => {
  it("reads indent from the first marker line", () => {
    expect(detectListBaseIndent("  - a\n  - b\n")).toBe("  ");
  });
});
