import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

import {
  attachSnapshotsPlugin,
  createSnapshotsPlugin,
  SNAPSHOTS_CAPTURE_COMMAND,
  type SnapshotsPlugin
} from "../src/plugin";
import { createMemorySnapshotStore } from "../src/store";

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("createSnapshotsPlugin", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    editor?.destroy();
    container.remove();
  });

  function setup(
    pluginOptions: Parameters<typeof createSnapshotsPlugin>[0] = {},
    initialValue = "alpha"
  ): SnapshotsPlugin {
    const snapshots = createSnapshotsPlugin(pluginOptions);
    editor = createEditor({ container, initialValue, plugins: [snapshots] });
    attachSnapshotsPlugin(snapshots, editor);
    return snapshots;
  }

  it("captures the current document and lists it", async () => {
    const snapshots = setup();
    const meta = await snapshots.capture("first draft");

    expect(meta).not.toBeNull();
    expect(meta!.label).toBe("first draft");
    const metas = await snapshots.list();
    expect(metas.map((m) => m.id)).toEqual([meta!.id]);
  });

  it("captures via the editor command", async () => {
    const snapshots = setup();
    expect(editor.runCommand(SNAPSHOTS_CAPTURE_COMMAND)).toBe(true);
    await flushMicrotasks();

    expect(await snapshots.list()).toHaveLength(1);
  });

  it("registers the capture command with a readable label", () => {
    setup();
    const command = editor.getCommands().find((c) => c.id === SNAPSHOTS_CAPTURE_COMMAND);
    expect(command?.label).toBe("Snapshots: Take snapshot");
  });

  it("skips capture when content is unchanged", async () => {
    const snapshots = setup();
    await snapshots.capture();
    expect(await snapshots.capture()).toBeNull();
    expect(await snapshots.list()).toHaveLength(1);
  });

  it("auto-captures once after the idle interval", async () => {
    vi.useFakeTimers();
    try {
      const snapshots = setup({ autoCapture: { intervalMs: 1000 } });
      editor.setDocument("alpha edited");
      await vi.advanceTimersByTimeAsync(500);
      expect(await snapshots.list()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(600);
      expect(await snapshots.list()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets the idle timer while the user keeps typing", async () => {
    vi.useFakeTimers();
    try {
      const snapshots = setup({ autoCapture: { intervalMs: 1000 } });
      editor.setDocument("one");
      await vi.advanceTimersByTimeAsync(800);
      editor.setDocument("one two");
      await vi.advanceTimersByTimeAsync(800);
      expect(await snapshots.list()).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(300);
      expect(await snapshots.list()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not auto-capture when disabled", async () => {
    vi.useFakeTimers();
    try {
      const snapshots = setup();
      editor.setDocument("changed");
      await vi.runAllTimersAsync();
      expect(await snapshots.list()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores a snapshot and captures the pre-restore buffer as a safety snapshot", async () => {
    const snapshots = setup();
    const original = await snapshots.capture("original");
    editor.setDocument("beta");

    expect(await snapshots.restore(original!.id)).toBe(true);
    expect(editor.getDocument()).toBe("alpha");

    const metas = await snapshots.list();
    expect(metas).toHaveLength(2);
    expect(metas[0]!.label).toBe("Before restore");

    // Restoring the safety snapshot brings back the pre-restore buffer.
    expect(await snapshots.restore(metas[0]!.id)).toBe(true);
    expect(editor.getDocument()).toBe("beta");
  });

  it("restore is undoable as a single undo step", async () => {
    // CM history merges edits within its new-group delay; fake timers let
    // Date.now advance so the restore lands in its own undo group.
    vi.useFakeTimers();
    try {
      const snapshots = createSnapshotsPlugin();
      editor = createEditor({
        container,
        initialValue: "alpha",
        plugins: [createHistoryPlugin(), snapshots]
      });
      attachSnapshotsPlugin(snapshots, editor);

      const meta = await snapshots.capture();
      editor.setDocument("beta");
      await vi.advanceTimersByTimeAsync(1000);
      await snapshots.restore(meta!.id);
      expect(editor.getDocument()).toBe("alpha");

      expect(editor.undo()).toBe(true);
      expect(editor.getDocument()).toBe("beta");
    } finally {
      vi.useRealTimers();
    }
  });

  it("restore of a missing id is a no-op", async () => {
    const snapshots = setup();
    expect(await snapshots.restore("missing-id")).toBe(false);
    expect(editor.getDocument()).toBe("alpha");
    expect(await snapshots.list()).toHaveLength(0);
  });

  it("restore creates no safety snapshot when content already matches", async () => {
    const snapshots = setup();
    const meta = await snapshots.capture();
    expect(await snapshots.restore(meta!.id)).toBe(true);
    expect(await snapshots.list()).toHaveLength(1);
  });

  it("a restore does not schedule an auto-capture duplicate", async () => {
    vi.useFakeTimers();
    try {
      const snapshots = setup({ autoCapture: { intervalMs: 1000 } });
      const meta = await snapshots.capture("original");
      editor.setDocument("beta");
      await vi.advanceTimersByTimeAsync(1500); // idle auto-capture of "beta"
      expect(await snapshots.list()).toHaveLength(2);

      await snapshots.restore(meta!.id);
      await vi.runAllTimersAsync();
      // Still 2: the safety capture de-dupes against the auto-captured
      // "beta" (current content is already preserved), and the restore's
      // own setDocument must not trigger another auto-capture of "alpha".
      expect(await snapshots.list()).toHaveLength(2);
      expect(editor.getDocument()).toBe("alpha");
    } finally {
      vi.useRealTimers();
    }
  });

  it("scopes snapshots to the host-supplied document key", async () => {
    let active = "a.md";
    const store = createMemorySnapshotStore();
    const snapshots = setup({ store, getDocumentKey: () => active });
    await snapshots.capture("on a");

    active = "b.md";
    expect(await snapshots.list()).toHaveLength(0);
    await snapshots.capture("on b");

    active = "a.md";
    const metas = await snapshots.list();
    expect(metas).toHaveLength(1);
    expect(metas[0]!.label).toBe("on a");
  });

  it("remove and clear update subscribers", async () => {
    const snapshots = setup();
    const seen: number[] = [];
    snapshots.subscribe((metas) => seen.push(metas.length));
    await flushMicrotasks();

    const meta = await snapshots.capture();
    expect(await snapshots.remove(meta!.id)).toBe(true);
    await snapshots.capture();
    editor.setDocument("alpha two");
    await snapshots.capture("two");
    expect(await snapshots.clear()).toBe(true);

    // initial(0) → capture(1) → remove(0) → capture(1) → capture(2) → clear(0)
    expect(seen).toEqual([0, 1, 0, 1, 2, 0]);
  });

  it("unsubscribe stops further emissions", async () => {
    const snapshots = setup();
    const listener = vi.fn();
    const unsubscribe = snapshots.subscribe(listener);
    await flushMicrotasks();
    listener.mockClear();

    unsubscribe();
    await snapshots.capture();
    expect(listener).not.toHaveBeenCalled();
  });

  it("destroy detaches listeners and stops auto-capture", async () => {
    vi.useFakeTimers();
    try {
      const snapshots = setup({ autoCapture: { intervalMs: 1000 } });
      snapshots.destroy();
      editor.setDocument("changed");
      await vi.runAllTimersAsync();
      expect(await snapshots.list()).toHaveLength(0);
      expect(await snapshots.capture()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps working when the store throws", async () => {
    const store = createMemorySnapshotStore();
    vi.spyOn(store, "save").mockRejectedValueOnce(new Error("disk full"));
    const snapshots = setup({ store });

    expect(await snapshots.capture()).toBeNull();
    expect(await snapshots.capture("retry")).not.toBeNull();
    expect(editor.getDocument()).toBe("alpha");
  });
});
