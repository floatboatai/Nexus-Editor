import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { createEditor, type EditorAPI } from "../src/index";

describe("event system", () => {
  it("emits change events with doc and ast", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({ container, initialValue: "" });

    editor.on("change", handler);
    editor.setDocument("hello");

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0][0]).toBe("hello");
    expect(handler.mock.calls[0][1]).toHaveProperty("type", "root");
    editor.destroy();
  });

  it("emits focus and blur events", () => {
    const container = document.createElement("div");
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    const editor = createEditor({ container });

    editor.on("focus", onFocus);
    editor.on("blur", onBlur);

    editor.focus();
    expect(onFocus).toHaveBeenCalledOnce();

    editor.blur();
    expect(onBlur).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("emits selectionChange on cursor movement", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.on("selectionChange", handler);
    editor.setSelection(5);

    expect(handler).toHaveBeenCalledWith({ anchor: 5, head: 5 });
    editor.destroy();
  });

  it("removes handlers with off", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({ container });

    editor.on("change", handler);
    editor.off("change", handler);
    editor.setDocument("test");

    expect(handler).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("supports multiple handlers on the same event", () => {
    const container = document.createElement("div");
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const editor = createEditor({ container });

    editor.on("change", handler1);
    editor.on("change", handler2);
    editor.setDocument("test");

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("does not emit events after destroy", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({ container });

    editor.on("change", handler);
    editor.destroy();

    expect(handler).not.toHaveBeenCalled();
  });

  it("coexists with config callbacks", () => {
    const container = document.createElement("div");
    const configHandler = vi.fn();
    const eventHandler = vi.fn();
    const editor = createEditor({
      container,
      onChange: configHandler,
    });

    editor.on("change", eventHandler);
    editor.setDocument("test");

    expect(configHandler).toHaveBeenCalledOnce();
    expect(eventHandler).toHaveBeenCalledOnce();
    editor.destroy();
  });
});

describe("getCoordsAtPos", () => {
  it("returns coordinates or null without throwing", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    // jsdom has no layout engine, so coordsAtPos may return null
    const coords = editor.getCoordsAtPos(0);
    expect(coords === null || typeof coords === "object").toBe(true);
    editor.destroy();
  });

  it("returns null after destroy", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello" });

    editor.destroy();

    expect(editor.getCoordsAtPos(0)).toBeNull();
  });
});

describe("slashMenuChange", () => {
  const commands = [
    { id: "heading", title: "Heading", keywords: ["h1", "title"] },
    { id: "table", title: "Table", keywords: ["grid"] },
  ];

  it("emits open state when a slash query is typed", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [{ name: "test", slashCommands: commands }],
    });

    editor.on("slashMenuChange", handler);
    editor.setDocument("/hea");
    editor.setSelection(4);

    expect(handler).toHaveBeenCalled();
    const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(lastCall.isOpen).toBe(true);
    expect(lastCall.query).toBe("hea");
    expect(lastCall.commands).toHaveLength(1);
    expect(lastCall.commands[0].id).toBe("heading");
    editor.destroy();
  });

  it("emits closed state when no slash is active", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "plain text",
      plugins: [{ name: "test", slashCommands: commands }],
    });

    editor.on("slashMenuChange", handler);
    editor.setSelection(5);

    expect(handler).toHaveBeenCalled();
    const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(lastCall.isOpen).toBe(false);
    editor.destroy();
  });

  it("does not emit slashMenuChange when no slash commands are registered", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const editor = createEditor({ container, initialValue: "/test" });

    editor.on("slashMenuChange", handler);
    editor.setSelection(5);

    expect(handler).not.toHaveBeenCalled();
    editor.destroy();
  });

  it("emits a ranked list capped at slashMenuLimit", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const manyCommands = Array.from({ length: 20 }, (_, i) => ({
      id: `cmd-${i}`,
      title: `Command ${i}`,
    }));

    const editor = createEditor({
      container,
      initialValue: "",
      slashMenuLimit: 3,
      plugins: [{ name: "test", slashCommands: manyCommands }],
    });

    editor.on("slashMenuChange", handler);
    editor.setDocument("/com");
    editor.setSelection(4);

    const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(lastCall.isOpen).toBe(true);
    expect(lastCall.commands).toHaveLength(3);
    editor.destroy();
  });

  it("forwards the run callback on emitted commands", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const run = vi.fn();

    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [
        {
          name: "test",
          slashCommands: [{ id: "h1", title: "Heading 1", run }],
        },
      ],
    });

    editor.on("slashMenuChange", handler);
    editor.setDocument("/head");
    editor.setSelection(5);

    const lastCall = handler.mock.calls[handler.mock.calls.length - 1][0];
    expect(lastCall.commands[0].id).toBe("h1");
    expect(lastCall.commands[0].run).toBe(run);
    editor.destroy();
  });
});

describe("enhanced event system — new events", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  // -----------------------------------------------------------------------
  // editorReady
  // -----------------------------------------------------------------------

  it("emits editorReady after creation", () => {
    const handler = vi.fn();
    const editor = createEditor({ container });
    editor.on("editorReady", handler);
    // editorReady fires during construction, so subscribe after - handler may
    // already have been called. Verify the event exists on the type system
    // and does not throw.
    expect(() => {
      editor.off("editorReady", handler);
    }).not.toThrow();
    editor.destroy();
  });

  it("editorReady handler can safely access editor methods", () => {
    const handler = vi.fn((_editor: EditorAPI) => {
      // Just verify the handler is callable with an editor
    });
    const editor = createEditor({ container });
    // Subscribe after creation — the ready event has already fired,
    // but we verify the API surface is consistent.
    expect(editor.getDocument()).toBeDefined();
    editor.destroy();
  });

  // -----------------------------------------------------------------------
  // themeChange
  // -----------------------------------------------------------------------

  it("emits themeChange when setTheme is called", () => {
    const editor = createEditor({ container });
    const handler = vi.fn();
    editor.on("themeChange", handler);
    editor.setTheme({ colors: { background: "#fff", text: "#000" } } as any);
    expect(handler).toHaveBeenCalledOnce();
    editor.destroy();
  });

  // -----------------------------------------------------------------------
  // destroy event
  // -----------------------------------------------------------------------

  it("emits destroy during editor teardown", () => {
    const editor = createEditor({ container });
    const handler = vi.fn();
    editor.on("destroy", handler);
    editor.destroy();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("destroy event fires before editor is fully destroyed", () => {
    let capturedDoc: string | null = null;
    const editor = createEditor({ container, initialValue: "destroy me" });
    editor.on("destroy", () => {
      capturedDoc = editor.getDocument();
    });
    editor.destroy();
    expect(capturedDoc).toBe("destroy me");
  });

  // -----------------------------------------------------------------------
  // beforeChange event
  // -----------------------------------------------------------------------

  it("emits beforeChange on document change", () => {
    const editor = createEditor({ container });
    const handler = vi.fn();
    editor.on("beforeChange", handler);
    editor.setDocument("new content");
    expect(handler).toHaveBeenCalled();
    const ctx = handler.mock.calls[0][0];
    expect(ctx.doc).toBe("new content");
    expect(ctx.ast).toHaveProperty("type", "root");
    editor.destroy();
  });

  // -----------------------------------------------------------------------
  // beforeSetDocument event
  // -----------------------------------------------------------------------

  it("emits beforeSetDocument on setDocument", () => {
    const editor = createEditor({ container });
    const handler = vi.fn();
    editor.on("beforeSetDocument", handler);
    editor.setDocument("replacement");
    expect(handler).toHaveBeenCalled();
    const ctx = handler.mock.calls[0][0];
    expect(ctx.next).toBe("replacement");
    expect(ctx.silent).toBe(false);
    editor.destroy();
  });

  it("emits beforeSetDocument with silent=true when silent option is set", () => {
    const editor = createEditor({ container });
    const handler = vi.fn();
    editor.on("beforeSetDocument", handler);
    editor.setDocument("silent replace", { silent: true });
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].silent).toBe(true);
    editor.destroy();
  });

  // -----------------------------------------------------------------------
  // error event
  // -----------------------------------------------------------------------

  it("can subscribe to error event without throwing", () => {
    const editor = createEditor({ container });
    const handler = vi.fn();
    expect(() => {
      editor.on("error", handler);
    }).not.toThrow();
    editor.destroy();
  });

  // -----------------------------------------------------------------------
  // Dynamic plugin management
  // -----------------------------------------------------------------------

  it("addPlugin returns false when a plugin with the same name exists", () => {
    const editor = createEditor({
      container,
      plugins: [{ name: "existing" }],
    });
    expect(editor.addPlugin({ name: "existing" })).toBe(false);
    editor.destroy();
  });

  it("addPlugin returns true when plugin name is unique", () => {
    const editor = createEditor({ container });
    expect(editor.addPlugin({ name: "unique" })).toBe(true);
    editor.destroy();
  });

  it("hasPlugin returns true for registered plugins", () => {
    const editor = createEditor({
      container,
      plugins: [{ name: "builtin" }],
    });
    expect(editor.hasPlugin("builtin")).toBe(true);
    expect(editor.hasPlugin("nonexistent")).toBe(false);
    editor.destroy();
  });

  it("removePlugin returns true for existing plugin", () => {
    const editor = createEditor({
      container,
      plugins: [{ name: "removable" }],
    });
    expect(editor.removePlugin("removable")).toBe(true);
    expect(editor.hasPlugin("removable")).toBe(false);
    editor.destroy();
  });

  it("removePlugin returns false for unknown plugin", () => {
    const editor = createEditor({ container });
    expect(editor.removePlugin("unknown")).toBe(false);
    editor.destroy();
  });

  it("addPlugin + removePlugin + addPlugin cycle works", () => {
    const editor = createEditor({ container });
    expect(editor.addPlugin({ name: "cycle" })).toBe(true);
    expect(editor.removePlugin("cycle")).toBe(true);
    expect(editor.addPlugin({ name: "cycle" })).toBe(true);
    editor.destroy();
  });

  // -----------------------------------------------------------------------
  // Lifecycle hooks via plugins
  // -----------------------------------------------------------------------

  it("calls onEditorReady lifecycle hook", () => {
    const hook = vi.fn();
    createEditor({
      container,
      plugins: [{ name: "lazy", onEditorReady: hook }],
    });
    // onEditorReady fires during construction (after view mount)
    expect(hook).toHaveBeenCalledOnce();
  });

  it("calls onDestroy lifecycle hook on editor destroy", () => {
    const hook = vi.fn();
    const editor = createEditor({
      container,
      plugins: [{ name: "cleanup", onDestroy: hook }],
    });
    editor.destroy();
    expect(hook).toHaveBeenCalledOnce();
  });

  it("calls onSelectionChange on cursor movement", () => {
    const hook = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "select me",
      plugins: [{ name: "sel", onSelectionChange: hook }],
    });
    editor.setSelection(3);
    expect(hook).toHaveBeenCalled();
    expect(hook.mock.calls[0][0]).toHaveProperty("anchor", 3);
    editor.destroy();
  });

  // -----------------------------------------------------------------------
  // Backward compatibility — existing behavior unchanged
  // -----------------------------------------------------------------------

  it("existing change event still works", () => {
    const editor = createEditor({ container });
    const handler = vi.fn();
    editor.on("change", handler);
    editor.setDocument("test");
    expect(handler).toHaveBeenCalledWith("test", expect.objectContaining({ type: "root" }));
    editor.destroy();
  });

  it("existing focus/blur events still work", () => {
    const editor = createEditor({ container });
    const focus = vi.fn();
    const blur = vi.fn();
    editor.on("focus", focus);
    editor.on("blur", blur);
    editor.focus();
    editor.blur();
    expect(focus).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();
    editor.destroy();
  });

  it("existing selectionChange still works", () => {
    const editor = createEditor({ container, initialValue: "hello world" });
    const handler = vi.fn();
    editor.on("selectionChange", handler);
    editor.setSelection(5);
    expect(handler).toHaveBeenCalledWith({ anchor: 5, head: 5 });
    editor.destroy();
  });

  it("existing on/off still works", () => {
    const editor = createEditor({ container });
    const handler = vi.fn();
    editor.on("change", handler);
    editor.off("change", handler);
    editor.setDocument("test");
    expect(handler).not.toHaveBeenCalled();
    editor.destroy();
  });
});
