import type { List } from "mdast";
import { describe, expect, it } from "vitest";

import { createGfmPreset } from "../../preset-gfm/src/index";
import { createEditor } from "../src/index";
import { lezerStringToMdast } from "../src/lezer-mdast-adapter";
import { computeListReorderChange, getListItemRanges, type ListItemRange } from "../src/live-preview";

function topLevelList(markdown: string): List {
  const root = lezerStringToMdast(markdown);
  const list = root.children.find((n) => n.type === "list");
  if (!list || list.type !== "list") throw new Error("Expected a top-level list in fixture markdown");
  return list;
}

function ranges(markdown: string): ListItemRange[] {
  const list = topLevelList(markdown);
  return getListItemRanges(list, list.position!.end.offset!);
}

describe("list item drag reorder", () => {
  // ── Grip rendering ──

  it("renders one grip handle per top-level list item", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- alpha\n- beta\n- gamma\n\nend",
      livePreview: true,
    });
    editor.setSelection(editor.getDocument().length);
    expect(container.querySelectorAll(".nexus-list-item-grip").length).toBe(3);
    editor.destroy();
  });

  it("renders independent grips for a nested sub-list", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- parent one\n  - child a\n  - child b\n- parent two\n\nend",
      livePreview: true,
    });
    editor.setSelection(editor.getDocument().length);
    // 2 top-level items + 2 nested items = 4 grips total.
    expect(container.querySelectorAll(".nexus-list-item-grip").length).toBe(4);
    editor.destroy();
  });

  it("omits the grip for an item whose raw markup is revealed by the cursor", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- alpha\n- beta",
      livePreview: true,
    });
    editor.setSelection(2); // caret on the "alpha" line
    expect(container.querySelectorAll(".nexus-list-item-grip").length).toBe(1);
    editor.destroy();
  });

  // ── getListItemRanges ──

  it("computes one [from, to) range per sibling item, covering the full raw text", () => {
    const doc = "- alpha\n- beta\n- gamma";
    const r = ranges(doc);
    expect(r).toHaveLength(3);
    expect(doc.slice(r[0].from, r[0].to)).toBe("- alpha\n");
    expect(doc.slice(r[1].from, r[1].to)).toBe("- beta\n");
    expect(doc.slice(r[2].from, r[2].to)).toBe("- gamma");
  });

  it("keeps a nested sub-list inside its parent item's range", () => {
    const doc = "- parent one\n  - child a\n  - child b\n- parent two";
    const r = ranges(doc);
    expect(r).toHaveLength(2); // only the two top-level items
    expect(doc.slice(r[0].from, r[0].to)).toBe("- parent one\n  - child a\n  - child b\n");
    expect(doc.slice(r[1].from, r[1].to)).toBe("- parent two");
  });

  // ── computeListReorderChange (pure reorder logic) ──

  it("moves an item down past its neighbor", () => {
    const doc = "- alpha\n- beta\n- gamma";
    const r = ranges(doc);
    const change = computeListReorderChange(doc, r, 0, 1);
    expect(change).not.toBeNull();
    const result = doc.slice(0, change!.from) + change!.insert + doc.slice(change!.to);
    expect(result).toBe("- beta\n- alpha\n- gamma");
  });

  it("moves an item up past its neighbor", () => {
    const doc = "- alpha\n- beta\n- gamma";
    const r = ranges(doc);
    const change = computeListReorderChange(doc, r, 2, 0);
    expect(change).not.toBeNull();
    const result = doc.slice(0, change!.from) + change!.insert + doc.slice(change!.to);
    expect(result).toBe("- gamma\n- alpha\n- beta");
  });

  it("preserves a dragged item's nested indentation and content", () => {
    const doc = "- parent one\n  - child a\n  - child b\n- parent two\n- parent three";
    const r = ranges(doc);
    // Move "parent one" (with its nested children) below "parent two".
    const change = computeListReorderChange(doc, r, 0, 1);
    expect(change).not.toBeNull();
    const result = doc.slice(0, change!.from) + change!.insert + doc.slice(change!.to);
    expect(result).toBe(
      "- parent two\n- parent one\n  - child a\n  - child b\n- parent three"
    );
  });

  it("returns null for a no-op move (same index)", () => {
    const doc = "- alpha\n- beta";
    const r = ranges(doc);
    expect(computeListReorderChange(doc, r, 0, 0)).toBeNull();
  });

  it("returns null for an out-of-range index", () => {
    const doc = "- alpha\n- beta";
    const r = ranges(doc);
    expect(computeListReorderChange(doc, r, 0, 5)).toBeNull();
  });

  // ── End-to-end: applying the computed change through a real EditorView ──

  it("applies the computed change through the editor and updates getDocument()", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- [ ] alpha\n- [ ] beta\n- [ ] gamma",
      livePreview: true,
      plugins: [createGfmPreset()],
    });
    const doc = editor.getDocument();
    const r = ranges(doc);
    const change = computeListReorderChange(doc, r, 2, 0);
    expect(change).not.toBeNull();
    editor.setDocument(
      doc.slice(0, change!.from) + change!.insert + doc.slice(change!.to)
    );
    expect(editor.getDocument()).toBe("- [ ] gamma\n- [ ] alpha\n- [ ] beta");
    editor.destroy();
  });

  // ── Drag wiring smoke test (no real layout in jsdom, so this only checks
  // that starting and abandoning a drag doesn't throw and cleans up global
  // state — pixel-accurate drop targeting is covered manually per
  // CONTRIBUTING.md's "manual check in electron-demo" recommendation) ──

  it("starting and releasing a grip drag does not throw and resets cursor state", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- alpha\n- beta\n- gamma\n\nend",
      livePreview: true,
    });
    editor.setSelection(editor.getDocument().length);
    const grip = container.querySelector<HTMLElement>(".nexus-list-item-grip");
    expect(grip).not.toBeNull();

    grip!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(document.body.style.cursor).toBe("grabbing");

    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    expect(document.body.style.cursor).toBe("");
    // No drop target was ever established (jsdom reports no layout), so the
    // document must be unchanged.
    expect(editor.getDocument()).toBe("- alpha\n- beta\n- gamma\n\nend");
    editor.destroy();
  });

  it("ignores a stale drag if the document is mutated externally mid-drag (no crash, no corruption)", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "- alpha\n- beta\n- gamma",
      livePreview: true,
    });
    editor.setSelection(editor.getDocument().length);
    const grip = container.querySelector<HTMLElement>(".nexus-list-item-grip");
    expect(grip).not.toBeNull();

    grip!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));

    // Simulate a host calling setDocument() (e.g. an external sync, autosave
    // reformat, or collaborative edit) while the user is still holding the
    // grip mid-drag.
    editor.setDocument("- one\n- two\n- three");

    // Move so a drop gap gets computed, then release.
    document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientX: 10, clientY: 999 }));
    expect(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    }).not.toThrow();

    // The externally-set document must survive untouched — a stale drag must
    // not splice text computed from now-invalid offsets/snapshot.
    expect(editor.getDocument()).toBe("- one\n- two\n- three");
    editor.destroy();
  });
});
