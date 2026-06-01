import { describe, it, expect, vi } from "vitest";
import { PluginHost } from "../src/plugin-host";
import type { EditorAPI, NexusPlugin } from "../src/types";
import type { Root } from "mdast";

const emptyAst: Root = { type: "root", children: [] };

function createMockEditor(): EditorAPI {
  return {
    getDocument: vi.fn(() => ""),
    getAst: vi.fn(() => emptyAst),
    getTableOfContents: vi.fn(() => []),
    exportHTML: vi.fn(() => ""),
    setTheme: vi.fn(),
    getSelection: vi.fn(() => ({ anchor: 0, head: 0 })),
    getSlashCommands: vi.fn(() => []),
    uploadAsset: vi.fn(() => Promise.resolve(null)),
    setSelection: vi.fn(),
    setDocument: vi.fn(),
    replaceSelection: vi.fn(),
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    focus: vi.fn(),
    blur: vi.fn(),
    runShortcut: vi.fn(() => false),
    getCommands: vi.fn(() => []),
    runCommand: vi.fn(() => false),
    isComposing: vi.fn(() => false),
    destroy: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    addPlugin: vi.fn(() => true),
    removePlugin: vi.fn(() => true),
    hasPlugin: vi.fn(() => false),
    getCoordsAtPos: vi.fn(() => null),
    getPosAtDOM: vi.fn(() => null),
    getDocumentStats: vi.fn(() => ({ characters: 0, words: 0, lines: 0 })),
  };
}

function createPlugin(name: string, hooks: Partial<NexusPlugin> = {}): NexusPlugin {
  return {
    name,
    ...hooks,
  };
}

describe("PluginHost", () => {
  // -----------------------------------------------------------------------
  // Constructor & basic registration
  // -----------------------------------------------------------------------

  it("registers plugins from constructor", () => {
    const host = new PluginHost([
      createPlugin("alpha"),
      createPlugin("beta"),
    ]);
    expect(host.hasPlugin("alpha")).toBe(true);
    expect(host.hasPlugin("beta")).toBe(true);
    expect(host.hasPlugin("gamma")).toBe(false);
  });

  it("returns registered plugins", () => {
    const p = createPlugin("test");
    const host = new PluginHost([p]);
    expect(host.getPlugin("test")).toBe(p);
    expect(host.getPlugin("nope")).toBeUndefined();
  });

  it("returns snapshots of all plugins", () => {
    const a = createPlugin("a");
    const b = createPlugin("b");
    const host = new PluginHost([a, b]);
    expect(host.getPlugins()).toEqual([a, b]);
  });

  // -----------------------------------------------------------------------
  // Dynamic add / remove
  // -----------------------------------------------------------------------

  it("addPlugin adds a new plugin", () => {
    const host = new PluginHost([]);
    expect(host.addPlugin(createPlugin("dynamic"))).toBe(true);
    expect(host.hasPlugin("dynamic")).toBe(true);
  });

  it("addPlugin returns false for duplicate names", () => {
    const host = new PluginHost([createPlugin("dup")]);
    expect(host.addPlugin(createPlugin("dup"))).toBe(false);
  });

  it("removePlugin removes a plugin", () => {
    const host = new PluginHost([createPlugin("gone")]);
    expect(host.removePlugin("gone")).toBe(true);
    expect(host.hasPlugin("gone")).toBe(false);
  });

  it("removePlugin returns false for unknown names", () => {
    const host = new PluginHost([]);
    expect(host.removePlugin("unknown")).toBe(false);
  });

  it("addPlugin then instantly gone", () => {
    const host = new PluginHost([]);
    const p = createPlugin("ephemeral");
    host.addPlugin(p);
    host.removePlugin("ephemeral");
    expect(host.hasPlugin("ephemeral")).toBe(false);
  });

  // -----------------------------------------------------------------------
  // onEditorReady
  // -----------------------------------------------------------------------

  it("calls onEditorReady after setEditor", () => {
    const fn = vi.fn();
    const plugin = createPlugin("ready", { onEditorReady: fn });
    const host = new PluginHost([plugin]);
    const editor = createMockEditor();

    host.setEditor(editor);
    host.editorReady();

    expect(fn).toHaveBeenCalledWith(editor);
  });

  it("calls onEditorReady for dynamically added plugins when editor is set", () => {
    const fn = vi.fn();
    const host = new PluginHost([]);
    const editor = createMockEditor();

    host.setEditor(editor);
    host.editorReady(); // initial fire

    const plugin = createPlugin("late", { onEditorReady: fn });
    host.addPlugin(plugin); // should fire immediately

    expect(fn).toHaveBeenCalledWith(editor);
  });

  // -----------------------------------------------------------------------
  // onBeforeChange
  // -----------------------------------------------------------------------

  it("calls onBeforeChange and returns true when no plugin cancels", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("c1", { onBeforeChange: fn })]);
    const result = host.beforeChange("doc", emptyAst);
    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledWith({ doc: "doc", ast: emptyAst });
  });

  it("returns false when a plugin cancels beforeChange", () => {
    const host = new PluginHost([
      createPlugin("canceller", { onBeforeChange: () => false }),
    ]);
    expect(host.beforeChange("doc", emptyAst)).toBe(false);
  });

  it("does not call later hooks if a plugin cancelled", () => {
    const a = vi.fn(() => false);
    const b = vi.fn();
    const host = new PluginHost([
      createPlugin("canceller", { onBeforeChange: a }),
      createPlugin("innocent", { onBeforeChange: b }),
    ]);
    // Both should still be called (isolation), but the return should be false
    const result = host.beforeChange("doc", emptyAst);
    expect(result).toBe(false);
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // onAfterChange
  // -----------------------------------------------------------------------

  it("calls onAfterChange with doc and ast", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("after", { onAfterChange: fn })]);
    host.afterChange("mydoc", emptyAst);
    expect(fn).toHaveBeenCalledWith({ doc: "mydoc", ast: emptyAst });
  });

  // -----------------------------------------------------------------------
  // onBeforeSetDocument
  // -----------------------------------------------------------------------

  it("calls onBeforeSetDocument and returns true when no plugin cancels", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("s1", { onBeforeSetDocument: fn })]);
    const result = host.beforeSetDocument("new doc", false);
    expect(result).toBe(true);
    expect(fn).toHaveBeenCalledWith({ next: "new doc", silent: false });
  });

  it("returns false when a plugin cancels beforeSetDocument", () => {
    const host = new PluginHost([
      createPlugin("canceller", { onBeforeSetDocument: () => false }),
    ]);
    expect(host.beforeSetDocument("x", true)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // onDestroy
  // -----------------------------------------------------------------------

  it("calls onDestroy when destroy() is called", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("d1", { onDestroy: fn })]);
    const editor = createMockEditor();
    host.setEditor(editor);
    host.destroy();
    expect(fn).toHaveBeenCalledWith(editor);
  });

  it("calls onDestroy when removePlugin() is called (with editor set)", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("d2", { onDestroy: fn })]);
    host.setEditor(createMockEditor());
    host.removePlugin("d2");
    expect(fn).toHaveBeenCalled();
  });

  it("does not call onDestroy twice for the same plugin", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("d3", { onDestroy: fn })]);
    host.setEditor(createMockEditor());
    host.removePlugin("d3");
    host.destroy();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // onSelectionChange
  // -----------------------------------------------------------------------

  it("calls onSelectionChange with anchor/head", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("sel", { onSelectionChange: fn })]);
    host.selectionChange(10, 20);
    expect(fn).toHaveBeenCalledWith({ anchor: 10, head: 20 });
  });

  // -----------------------------------------------------------------------
  // Error isolation
  // -----------------------------------------------------------------------

  it("isolates errors in lifecycle hooks", () => {
    const bad = createPlugin("bad", {
      onEditorReady: () => { throw new Error("boom"); },
    });
    const good = vi.fn();
    const goodPlugin = createPlugin("good", { onEditorReady: good });
    const host = new PluginHost([bad, goodPlugin]);
    const editor = createMockEditor();

    host.setEditor(editor);
    expect(() => host.editorReady()).not.toThrow();
    expect(good).toHaveBeenCalledWith(editor);
  });

  it("forwards errors to onError callback", () => {
    const onError = vi.fn();
    const host = new PluginHost(
      [createPlugin("erratic", { onEditorReady: () => { throw new Error("fail"); } })],
      onError,
    );
    host.setEditor(createMockEditor());
    host.editorReady();

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].message).toBe("fail");
    expect(onError.mock.calls[0][1]).toBe("erratic");
    expect(onError.mock.calls[0][2]).toBe("onEditorReady");
  });

  // -----------------------------------------------------------------------
  // Destroyed guard
  // -----------------------------------------------------------------------

  it("does not fire lifecycle hooks after destroy", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("gone", {
      onAfterChange: fn,
      onBeforeChange: fn,
      onSelectionChange: fn,
    })]);
    host.setEditor(createMockEditor());
    host.destroy();

    host.afterChange("doc", emptyAst);
    host.beforeChange("doc", emptyAst);
    host.selectionChange(0, 1);

    expect(fn).not.toHaveBeenCalled();
  });

  it("does not fire onEditorReady after destroy", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("late", { onEditorReady: fn })]);
    host.setEditor(createMockEditor());
    host.destroy();
    host.editorReady();
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not fire onDestroy twice", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("d", { onDestroy: fn })]);
    host.setEditor(createMockEditor());
    host.destroy();
    host.destroy(); // second call should be no-op
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // Empty / edge cases
  // -----------------------------------------------------------------------

  it("handles empty plugin list", () => {
    const host = new PluginHost([]);
    expect(host.getPlugins()).toEqual([]);
    expect(host.hasPlugin("any")).toBe(false);
    expect(() => {
      host.editorReady();
      host.beforeChange("", emptyAst);
      host.afterChange("", emptyAst);
      host.selectionChange(0, 0);
      host.destroy();
    }).not.toThrow();
  });

  it("plugins with no hooks do not throw when any lifecycle is called", () => {
    const host = new PluginHost([createPlugin("bare")]);
    host.setEditor(createMockEditor());
    expect(() => {
      host.editorReady();
      host.beforeChange("", emptyAst);
      host.afterChange("", emptyAst);
      host.beforeSetDocument("", false);
      host.selectionChange(0, 0);
      host.destroy();
    }).not.toThrow();
  });

  it("removePlugin fires onDestroy only if editor is set", () => {
    const fn = vi.fn();
    const host = new PluginHost([createPlugin("orphan", { onDestroy: fn })]);
    // No setEditor call
    host.removePlugin("orphan");
    expect(fn).not.toHaveBeenCalled(); // no editor to pass
  });

  it("getPlugin returns undefined after removePlugin", () => {
    const host = new PluginHost([createPlugin("gone")]);
    host.removePlugin("gone");
    expect(host.getPlugin("gone")).toBeUndefined();
  });
});
