import { describe, expect, it, vi } from "vitest";

import { createEditor } from "../src/index";

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
