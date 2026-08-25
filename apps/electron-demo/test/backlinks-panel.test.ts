import { afterEach, describe, expect, it, vi } from "vitest";

import { createBacklinksPanel } from "../src/renderer/backlinks-panel";
import type { LinkIndexListener, LinkIndexReader } from "../src/renderer/link-index";

interface ScheduledIdleCallback {
  readonly id: number;
  readonly callback: () => void;
}

function installIdleHarness() {
  const scheduled: ScheduledIdleCallback[] = [];
  let nextId = 0;
  const request = vi.fn((callback: () => void) => {
    const task = { id: ++nextId, callback };
    scheduled.push(task);
    return task.id;
  });
  const cancel = vi.fn<(id: number) => void>();
  vi.stubGlobal("requestIdleCallback", request);
  vi.stubGlobal("cancelIdleCallback", cancel);
  return { scheduled, request, cancel };
}

function createIndexHarness() {
  let listener: LinkIndexListener | null = null;
  const unsubscribe = vi.fn();
  const index: LinkIndexReader = {
    resolve: vi.fn(() => null),
    getAllNoteNames: vi.fn(() => []),
    getBacklinks: vi.fn(() => []),
    getUnlinkedMentions: vi.fn(() => []),
    subscribe: vi.fn((next) => {
      listener = next;
      return unsubscribe;
    }),
  };
  return {
    index,
    unsubscribe,
    emit() {
      listener?.();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("BacklinksPanel visibility lifecycle", () => {
  it("cancels pending work and coalesces hidden invalidations", () => {
    const idle = installIdleHarness();
    const index = createIndexHarness();
    const panel = createBacklinksPanel({
      index: index.index,
      getActiveFile: () => "/vault/target.md",
      onOpenFile: vi.fn(),
    });
    document.body.append(panel.element);

    expect(index.index.getBacklinks).toHaveBeenCalledOnce();
    expect(idle.request).toHaveBeenCalledOnce();
    const cancelledTask = idle.scheduled[0];

    panel.setVisible(false);
    expect(idle.cancel).toHaveBeenCalledWith(cancelledTask?.id);
    vi.mocked(index.index.getBacklinks).mockClear();
    idle.request.mockClear();

    for (let count = 0; count < 100; count += 1) index.emit();
    panel.refresh();

    expect(index.index.getBacklinks).not.toHaveBeenCalled();
    expect(index.index.getUnlinkedMentions).not.toHaveBeenCalled();
    expect(idle.request).not.toHaveBeenCalled();

    cancelledTask?.callback();
    expect(index.index.getUnlinkedMentions).not.toHaveBeenCalled();

    panel.setVisible(true);
    expect(index.index.getBacklinks).toHaveBeenCalledOnce();
    expect(idle.request).toHaveBeenCalledOnce();

    idle.scheduled.at(-1)?.callback();
    expect(index.index.getUnlinkedMentions).toHaveBeenCalledOnce();

    panel.destroy();
  });

  it("prevents scheduled callbacks from outliving the panel", () => {
    const idle = installIdleHarness();
    const index = createIndexHarness();
    const panel = createBacklinksPanel({
      index: index.index,
      getActiveFile: () => "/vault/target.md",
      onOpenFile: vi.fn(),
    });
    const scheduledTask = idle.scheduled[0];

    panel.destroy();
    scheduledTask?.callback();

    expect(index.index.getUnlinkedMentions).not.toHaveBeenCalled();
    expect(index.unsubscribe).toHaveBeenCalledOnce();
    expect(panel.element.isConnected).toBe(false);

    panel.refresh();
    panel.setVisible(true);
    panel.destroy();
    expect(index.unsubscribe).toHaveBeenCalledOnce();
  });

  it("discards stale scans when the active file changes", () => {
    const idle = installIdleHarness();
    const index = createIndexHarness();
    let activeFile = "/vault/first.md";
    const panel = createBacklinksPanel({
      index: index.index,
      getActiveFile: () => activeFile,
      onOpenFile: vi.fn(),
    });
    const firstTask = idle.scheduled[0];

    activeFile = "/vault/second.md";
    firstTask?.callback();

    expect(index.index.getUnlinkedMentions).not.toHaveBeenCalled();
    expect(index.index.getBacklinks).toHaveBeenLastCalledWith("/vault/second.md");
    expect(idle.request).toHaveBeenCalledTimes(2);

    idle.scheduled[1]?.callback();
    expect(index.index.getUnlinkedMentions).toHaveBeenCalledOnce();
    expect(index.index.getUnlinkedMentions).toHaveBeenCalledWith("/vault/second.md");

    panel.destroy();
  });

  it("does not refresh a clean panel when visibility changes", () => {
    const idle = installIdleHarness();
    const index = createIndexHarness();
    const panel = createBacklinksPanel({
      index: index.index,
      getActiveFile: () => "/vault/target.md",
      onOpenFile: vi.fn(),
    });
    idle.scheduled[0]?.callback();

    vi.mocked(index.index.getBacklinks).mockClear();
    idle.request.mockClear();
    panel.setVisible(false);
    panel.setVisible(true);
    panel.setVisible(true);

    expect(index.index.getBacklinks).not.toHaveBeenCalled();
    expect(idle.request).not.toHaveBeenCalled();
    panel.destroy();
  });

  it("coalesces a burst of visible index invalidations", async () => {
    const idle = installIdleHarness();
    const index = createIndexHarness();
    const panel = createBacklinksPanel({
      index: index.index,
      getActiveFile: () => "/vault/target.md",
      onOpenFile: vi.fn(),
    });
    idle.scheduled[0]?.callback();
    vi.mocked(index.index.getBacklinks).mockClear();
    idle.request.mockClear();

    for (let count = 0; count < 100; count += 1) index.emit();
    expect(index.index.getBacklinks).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(index.index.getBacklinks).toHaveBeenCalledOnce();
    expect(idle.request).toHaveBeenCalledOnce();

    panel.destroy();
  });
});
