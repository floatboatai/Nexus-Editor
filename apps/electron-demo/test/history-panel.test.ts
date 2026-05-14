import { describe, expect, it, vi } from "vitest";
import { createHistoryPanel } from "../src/renderer/history-panel";
import type { SnapshotEntry } from "../src/renderer/snapshot-entry";

function makeSnapshot(overrides: Partial<SnapshotEntry> = {}): SnapshotEntry {
  return {
    id: "snap-1",
    docKey: "doc-a",
    filePath: "/tmp/a.md",
    title: "Snapshot title",
    content: "# Hello",
    createdAt: "2026-05-13T12:00:00.000Z",
    summary: "# Hello",
    ...overrides,
  };
}

describe("history panel", () => {
  it("renders an empty state when there are no snapshots", () => {
    const panel = createHistoryPanel({
      getSnapshots: () => [],
      onRestore: vi.fn(),
      onReuse: vi.fn(),
    });

    expect(panel.element.textContent).toContain("No snapshots yet");
  });

  it("renders snapshots and wires restore/reuse actions", () => {
    const onRestore = vi.fn();
    const onReuse = vi.fn();
    const snapshot = makeSnapshot();
    const panel = createHistoryPanel({
      getSnapshots: () => [snapshot],
      onRestore,
      onReuse,
    });

    const buttons = panel.element.querySelectorAll("button");
    expect(panel.element.textContent).toContain("Snapshot title");
    expect(buttons).toHaveLength(2);

    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    buttons[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onRestore).toHaveBeenCalledWith(snapshot);
    expect(onReuse).toHaveBeenCalledWith(snapshot);
  });
});
