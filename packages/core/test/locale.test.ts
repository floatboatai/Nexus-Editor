import { describe, expect, it } from "vitest";

import {
  createEditor,
  detectLocaleCode,
  enLocale,
  getLocale,
  resolveLocale,
  setLocale,
  setLocaleCode,
  zhLocale,
} from "../src/index";
import { createGfmPreset } from "../../preset-gfm/src/index";

describe("internationalization", () => {
  it("resolveLocale returns English by default", () => {
    const locale = resolveLocale();
    expect(locale.addColumn).toBe("Add column");
    expect(locale.addRow).toBe("Add row");
    expect(locale.deleteColumn).toBe("Delete column");
  });

  it("resolveLocale merges partial overrides with English defaults", () => {
    const locale = resolveLocale({ addColumn: "Custom" });
    expect(locale.addColumn).toBe("Custom");
    expect(locale.addRow).toBe("Add row"); // Fallback to English
  });

  it("zhLocale provides all Chinese translations", () => {
    expect(zhLocale.addColumn).toBe("添加列");
    expect(zhLocale.addRow).toBe("添加行");
    expect(zhLocale.deleteColumn).toBe("删除列");
    expect(zhLocale.openLink).toBe("打开链接");
  });

  it("editor uses locale for table button labels", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "| A | B |\n| --- | --- |\n| 1 | 2 |",
      livePreview: true,
      locale: zhLocale,
      plugins: [createGfmPreset()]
    });

    // The add-column button should have Chinese title
    const addColBtn = container.querySelector("button[title='添加列']");
    expect(addColBtn).not.toBeNull();
    editor.destroy();
  });

  it("enLocale has all required keys", () => {
    const keys: (keyof typeof enLocale)[] = [
      "addColumn", "addRow", "deleteColumn", "deleteRow",
      "insertColumnBefore", "insertColumnAfter",
      "insertRowAbove", "insertRowBelow",
      "alignLeft", "alignCenter", "alignRight",
      "foldCode", "unfoldCode", "foldHeading", "unfoldHeading",
      "openLink", "codeBlockLabel"
    ];
    for (const key of keys) {
      expect(typeof enLocale[key]).toBe("string");
      expect(enLocale[key].length).toBeGreaterThan(0);
    }
  });
});

describe("locale store", () => {
  it("getLocale returns English by default", () => {
    setLocaleCode("en");
    expect(getLocale().addColumn).toBe("Add column");
  });

  it("setLocaleCode switches the shared locale", () => {
    setLocaleCode("zh");
    expect(getLocale().toolbarBold).toBe("加粗");
    expect(getLocale().searchFind).toBe("查找");
    expect(getLocale().wordcountWords).toBe("词");
    setLocaleCode("en");
  });

  it("setLocale merges partial overrides with English defaults", () => {
    setLocale({ toolbarBold: "自定义" });
    expect(getLocale().toolbarBold).toBe("自定义");
    expect(getLocale().toolbarItalic).toBe("Italic");
    setLocaleCode("en");
  });

  it("detectLocaleCode returns a built-in code or null", () => {
    const code = detectLocaleCode();
    expect(code === null || code === "en" || code === "zh").toBe(true);
  });
});

describe("locale parity", () => {
  it("enLocale and zhLocale expose identical keys", () => {
    expect(Object.keys(zhLocale).sort()).toEqual(Object.keys(enLocale).sort());
  });

  it("every locale value is a non-empty string", () => {
    for (const value of Object.values(zhLocale)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });
});
