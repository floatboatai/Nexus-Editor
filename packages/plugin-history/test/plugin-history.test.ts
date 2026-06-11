import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin } from "../src/index";

describe("@floatboat/nexus-plugin-history", () => {
  it("undoes the most recent document change through codemirror key handling", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()]
    });

    const content = container.querySelector("[contenteditable='true']");

    editor.setDocument("next");

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    expect(editor.getDocument()).toBe("start");
    editor.destroy();
  });

  it("redoes an undone change through codemirror key handling", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()]
    });

    const content = container.querySelector("[contenteditable='true']");

    editor.setDocument("next");

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    expect(editor.getDocument()).toBe("next");
    editor.destroy();
  });

  it("accepts custom newGroupDelay and minDepth options", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [
        createHistoryPlugin({ newGroupDelay: 300, minDepth: 2 }),
      ],
    });

    // 基本功能应正常：修改后可撤销
    editor.setDocument("next");
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(editor.getDocument()).toBe("start");
    editor.destroy();
  });

  it("exposes canUndo / canRedo correctly when history plugin is active", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    // 初始状态无可撤销
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);

    // 修改后
    editor.setDocument("next");
    expect(editor.canUndo()).toBe(true);
    expect(editor.canRedo()).toBe(false);

    // undo 后
    editor.undo();
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(true);

    // redo 后
    editor.redo();
    expect(editor.canUndo()).toBe(true);
    expect(editor.canRedo()).toBe(false);

    editor.destroy();
  });

  it("emits historyChange events when plugin is active", () => {
    const container = document.createElement("div");
    const events: Array<{ canUndo: boolean; canRedo: boolean }> = [];

    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });
    editor.on("historyChange", (state) => events.push(state));

    editor.setDocument("next");
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1].canUndo).toBe(true);

    editor.undo();
    expect(events[events.length - 1]).toEqual({ canUndo: false, canRedo: true });

    editor.destroy();
  });

  it("backward compatible: createHistoryPlugin() without arguments still works", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    const content = container.querySelector("[contenteditable='true']");

    // 原有测试逻辑：修改 → Ctrl+Z 撤销 → Ctrl+Y 重做，都必须正常
    editor.setDocument("next");

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(editor.getDocument()).toBe("start");

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(editor.getDocument()).toBe("next");

    editor.destroy();
  });

  it("emits historyChange in correct sequence across multiple edits", () => {
    const container = document.createElement("div");
    const events: Array<{ canUndo: boolean; canRedo: boolean }> = [];

    const editor = createEditor({
      container,
      initialValue: "one",
      plugins: [createHistoryPlugin()],
    });
    editor.on("historyChange", (state) => events.push(state));

    // 初始状态 — 无事件
    expect(events).toEqual([]);

    // 第一次编辑：无 undo → 有 undo
    editor.setDocument("two");
    expect(events[events.length - 1]).toEqual({ canUndo: true, canRedo: false });

    // 第二次编辑在 500ms 默认 newGroupDelay 内：合并为同一撤销组，状态不变
    const beforeSecond = events.length;
    editor.setDocument("three");
    expect(events.length).toBe(beforeSecond);

    // undo 回退到 "one"（两次 setDocument 被合并为一组）
    editor.undo();
    expect(events[events.length - 1]).toEqual({ canUndo: false, canRedo: true });

    // redo 前推到 "three"
    editor.redo();
    expect(events[events.length - 1]).toEqual({ canUndo: true, canRedo: false });

    editor.destroy();
  });

  it("clearHistory via editor.runCommand resets canUndo/canRedo to false", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    // 产生撤销历史
    editor.setDocument("next");
    expect(editor.canUndo()).toBe(true);

    // 清空历史
    const result = editor.runCommand("history.clear");
    expect(result).toBe(true);
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);

    editor.destroy();
  });

  it("clearHistory emits historyChange with both false after clearing", () => {
    const container = document.createElement("div");
    const events: Array<{ canUndo: boolean; canRedo: boolean }> = [];

    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });
    editor.on("historyChange", (state) => events.push(state));

    // 产生历史
    editor.setDocument("next");
    expect(events[events.length - 1]).toEqual({ canUndo: true, canRedo: false });

    // 清空历史 → 应触发 historyChange({ canUndo: false, canRedo: false })
    editor.runCommand("history.clear");
    expect(events[events.length - 1]).toEqual({ canUndo: false, canRedo: false });

    // 再次修改 → 再次可撤销
    editor.setDocument("after clear");
    expect(events[events.length - 1]).toEqual({ canUndo: true, canRedo: false });

    editor.destroy();
  });

  it("clearHistory does nothing when there is no history to clear", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    // 还没有任何操作
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);

    // clearHistory 应该安全执行（不抛异常）
    const result = editor.runCommand("history.clear");
    expect(result).toBe(true);
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);

    editor.destroy();
  });

  it("undo() returns false after clearHistory even if history was non-empty", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    editor.setDocument("next");
    expect(editor.canUndo()).toBe(true);

    editor.runCommand("history.clear");

    // clearHistory 后栈为空，undo 应返回 false
    expect(editor.canUndo()).toBe(false);
    expect(editor.undo()).toBe(false);
    expect(editor.getDocument()).toBe("next");  // 文档不变
    editor.destroy();
  });

  it("fresh edits after clearHistory create new undo entries", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    // 产生并清空历史
    editor.setDocument("next");
    editor.runCommand("history.clear");
    expect(editor.canUndo()).toBe(false);

    // 清空后的新编辑应产生全新 undo 条目
    editor.setDocument("fresh");
    expect(editor.canUndo()).toBe(true);
    editor.undo();
    expect(editor.getDocument()).toBe("next");
    editor.destroy();
  });

  it("clearHistory is idempotent — calling twice has same effect as once", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    editor.setDocument("next");
    expect(editor.canUndo()).toBe(true);

    editor.runCommand("history.clear");
    expect(editor.canUndo()).toBe(false);

    // 第二次调用应安全无副作用
    editor.runCommand("history.clear");
    expect(editor.canUndo()).toBe(false);
    expect(editor.canRedo()).toBe(false);
    expect(editor.getDocument()).toBe("next");  // 文档不变
    editor.destroy();
  });

  it("Ctrl+Z after clearHistory has no effect on document", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "start",
      plugins: [createHistoryPlugin()],
    });

    editor.setDocument("next");
    editor.runCommand("history.clear");

    const content = container.querySelector("[contenteditable='true']");
    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    // 历史已清空，Ctrl+Z 不应改变文档
    expect(editor.getDocument()).toBe("next");
    editor.destroy();
  });
});
