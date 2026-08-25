import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin } from "../src/index";

/** 模拟按键：在 contenteditable 元素上触发 Ctrl+Z */
function pressCtrlZ(container: HTMLElement) {
  const content = container.querySelector("[contenteditable='true']");
  content?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "z",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
  );
}

/** 模拟按键：在 contenteditable 元素上触发 Ctrl+Y */
function pressCtrlY(container: HTMLElement) {
  const content = container.querySelector("[contenteditable='true']");
  content?.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "y",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
  );
}

/**
 * 通过 replaceRange 模拟逐字输入 "hello"。
 * 每次调用产生一个独立的 CM6 transaction。
 */
function typeHello(editor: ReturnType<typeof createEditor>) {
  editor.replaceRange(0, 0, "h");
  editor.replaceRange(1, 1, "e");
  editor.replaceRange(2, 2, "l");
  editor.replaceRange(3, 3, "l");
  editor.replaceRange(4, 4, "o");
}

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

  // =========================
  // 撤销/重做分组测试
  // =========================

  it("默认分组：快速连续操作合并为一个撤销步骤", () => {
    // 使用默认配置（newGroupDelay=500ms），所有同步 replaceRange
    // 调用在同一毫秒内完成 → 时间差 0 < 500 → 自动合并。
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [createHistoryPlugin()]
    });

    typeHello(editor);
    expect(editor.getDocument()).toBe("hello");

    // 一次 Ctrl+Z 应该撤销全部 5 个字符，回到空文档
    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("");

    editor.destroy();
  });

  it("默认分组：快速连续操作撤销后可重做全部", () => {
    // 验证 Ctrl+Y 也能一次性重做整组操作。
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [createHistoryPlugin()]
    });

    typeHello(editor);
    expect(editor.getDocument()).toBe("hello");

    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("");

    pressCtrlY(container);
    expect(editor.getDocument()).toBe("hello");

    editor.destroy();
  });

  it("禁用分组（newGroupDelay=0）：每次操作独立为一个撤销步骤", () => {
    // newGroupDelay=0 时，time - prevTime = 0，0 < 0 为 false，
    // 条件不满足 → 每个 transaction 独立成组。
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "",
      plugins: [createHistoryPlugin({ newGroupDelay: 0 })]
    });

    typeHello(editor);
    expect(editor.getDocument()).toBe("hello");

    // 第一次 Ctrl+Z 只撤销最后一个字符 "o"
    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("hell");

    // 第二次 Ctrl+Z 撤销 "l"
    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("hel");

    editor.destroy();
  });

  it("setDocument 在默认分组下与相邻编辑合并为一步撤销", () => {
    // setDocument 替换了整篇文档（变更范围 [0, docLength]），与之前
    // 的逐字插入在 isAdjacent 检查中判定为相邻（范围重叠），因此在
    // 默认的 500ms 时间窗口内会被合并。一次 Ctrl+Z 撤销全部操作。
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "before",
      plugins: [createHistoryPlugin()]
    });

    editor.replaceRange(6, 6, "x");  // "beforex"
    editor.replaceRange(7, 7, "y");  // "beforexy"
    editor.setDocument("after");

    // 默认分组下，三次操作合并为一步撤销
    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("before");

    editor.destroy();
  });

  it("newGroupDelay=0 时 setDocument 与 replaceRange 各自独立", () => {
    // 禁用时间分组后，每次操作都是独立的撤销步骤。
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "before",
      plugins: [createHistoryPlugin({ newGroupDelay: 0 })]
    });

    editor.replaceRange(6, 6, "x");
    editor.replaceRange(7, 7, "y");
    editor.setDocument("after");

    // 第一次 Ctrl+Z 撤销 setDocument
    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("beforexy");

    // 第二次 Ctrl+Z 撤销 "y"
    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("beforex");

    editor.destroy();
  });

  it("相邻位置的编辑被合并，不相邻位置的编辑保持独立", () => {
    // 在文档不同位置编辑 → isAdjacent 返回 false → 独立成组。
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "a c",
      plugins: [createHistoryPlugin()]
    });

    // 在位置 1 插入（与位置 1 的内容相邻）
    editor.replaceRange(1, 1, "b");  // "ab c"
    // 在位置 3 插入（与位置 1 不相邻）
    editor.replaceRange(3, 3, "d");  // "ab cd"

    // Ctrl+Z 只撤销最后一个操作
    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("ab c");

    // 再 Ctrl+Z 撤销第一个操作
    pressCtrlZ(container);
    expect(editor.getDocument()).toBe("a c");

    editor.destroy();
  });
});
