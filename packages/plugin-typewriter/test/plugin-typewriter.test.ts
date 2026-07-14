import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it, vi } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import { createTypewriterPlugin } from "../src/index";

function createViewWithPlugin(doc = "a\nb\nc"): EditorView {
  const plugin = createTypewriterPlugin();
  return new EditorView({ state: EditorState.create({ doc, extensions: plugin.cmExtensions! }) });
}

interface MeasureRequest {
  key?: unknown;
  read: (view: EditorView) => number | null;
  write: (offset: number | null, view: EditorView) => void;
}

/** First requestMeasure call carrying our request object (CM itself also calls it bare). */
function firstPluginRequest(spy: { mock: { calls: unknown[][] } }): MeasureRequest {
  const call = spy.mock.calls.find((c) => c[0] !== undefined);
  if (!call) throw new Error("expected the plugin to have scheduled a measure request");
  return call[0] as MeasureRequest;
}

describe("createTypewriterPlugin", () => {
  it("declares only hot-pluggable hooks (name + cmExtensions)", () => {
    const plugin = createTypewriterPlugin();

    expect(plugin.name).toBe("plugin-typewriter");
    expect(plugin.cmExtensions).toHaveLength(1);
    // Hot-pluggable by construction: no construction-time hooks declared.
    expect(Object.keys(plugin).sort()).toEqual(["cmExtensions", "name"]);
  });

  it("schedules a measure pass after a doc change", () => {
    const view = createViewWithPlugin();
    const measureSpy = vi.spyOn(view, "requestMeasure");

    view.dispatch({ changes: { from: 0, insert: "x" } });

    // The centering correction runs inside CM's measure cycle (read cursor
    // geometry → write scrollTop) instead of dispatching a scrollIntoView
    // effect — see the design note in src/index.ts for why the effect-based
    // approach loses a race against native "nearest" scroll requests.
    const request = firstPluginRequest(measureSpy);
    expect(request).toHaveProperty("read");
    expect(request).toHaveProperty("write");

    view.destroy();
  });

  it("schedules a measure pass after selection-only movement", () => {
    const view = createViewWithPlugin();
    const measureSpy = vi.spyOn(view, "requestMeasure");

    view.dispatch({ selection: { anchor: 4 } });

    expect(firstPluginRequest(measureSpy)).toBeDefined();
    view.destroy();
  });

  it("does not schedule a measure pass when neither doc nor selection changed", () => {
    const view = createViewWithPlugin();
    const measureSpy = vi.spyOn(view, "requestMeasure");

    view.dispatch({}); // no changes, no explicit selection

    // CM itself calls bare requestMeasure() internally; only calls carrying
    // our read/write request object belong to the plugin.
    const pluginCalls = measureSpy.mock.calls.filter((call) => call[0] !== undefined);
    expect(pluginCalls).toHaveLength(0);
    view.destroy();
  });

  it("coalesces rapid sequential updates under one measure key", () => {
    const view = createViewWithPlugin();
    const measureSpy = vi.spyOn(view, "requestMeasure");

    view.dispatch({ changes: { from: 0, insert: "x" } });
    view.dispatch({ changes: { from: 0, insert: "y" } });
    view.dispatch({ changes: { from: 0, insert: "z" } });

    // Same `key` across calls → CM replaces the pending request instead of
    // stacking three; exactly the hold-Enter burst scenario from the demo.
    // (Bare no-arg calls are CM's own internal scheduling — not ours.)
    const keys = measureSpy.mock.calls
      .filter((call) => call[0] !== undefined)
      .map((call) => call[0]!.key);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBeDefined();

    view.destroy();
  });

  it("computes the scroll correction from cursor vs scroller center, and skips when unmeasurable", () => {
    const view = createViewWithPlugin();
    const measureSpy = vi.spyOn(view, "requestMeasure");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    const { read, write } = firstPluginRequest(measureSpy);

    // jsdom has no layout: coordsAtPos yields null → read returns null →
    // write must be a no-op rather than corrupting scrollTop with NaN.
    expect(read(view)).toBeNull();
    const before = view.scrollDOM.scrollTop;
    write(null, view);
    expect(view.scrollDOM.scrollTop).toBe(before);

    // With synthetic geometry: cursor center 40px below scroller center →
    // write scrolls down by exactly that offset.
    vi.spyOn(view, "coordsAtPos").mockReturnValue({ top: 130, bottom: 150, left: 0, right: 1 });
    vi.spyOn(view.scrollDOM, "getBoundingClientRect").mockReturnValue({
      top: 0, bottom: 200, left: 0, right: 100, width: 100, height: 200, x: 0, y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    expect(read(view)).toBe(40);
    write(40, view);
    expect(view.scrollDOM.scrollTop).toBe(before + 40);

    view.destroy();
  });

  it("makes queued measure passes no-ops after destroy", () => {
    const view = createViewWithPlugin();
    const measureSpy = vi.spyOn(view, "requestMeasure");
    view.dispatch({ changes: { from: 0, insert: "x" } });
    const { read, write } = firstPluginRequest(measureSpy);
    vi.spyOn(view, "coordsAtPos").mockReturnValue({ top: 130, bottom: 150, left: 0, right: 1 });

    view.destroy(); // flips the plugin's destroyed guard

    // A measure request that resolves after teardown must not touch the view.
    expect(read(view)).toBeNull();
    const before = view.scrollDOM.scrollTop;
    write(40, view);
    expect(view.scrollDOM.scrollTop).toBe(before);
  });

  it("survives a runtime install/uninstall round-trip", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.addPlugin(createTypewriterPlugin());
    expect(editor.getPlugins()).toContainEqual({ name: "plugin-typewriter", runtime: true });
    // Editing while installed works (the measure pass resolves cleanly in jsdom).
    editor.replaceRange(5, 5, " world");
    expect(editor.getDocument()).toBe("hello world");

    expect(editor.removePlugin("plugin-typewriter")).toBe(true);
    expect(editor.getPlugins()).not.toContainEqual({ name: "plugin-typewriter", runtime: true });
    editor.replaceRange(0, 0, "> ");
    expect(editor.getDocument()).toBe("> hello world");

    editor.destroy();
  });
});
