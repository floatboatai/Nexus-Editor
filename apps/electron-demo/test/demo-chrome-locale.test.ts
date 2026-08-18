import { beforeEach, describe, expect, it } from "vitest";
import type { EditorAPI, TocEntry } from "@floatboat/nexus-core";
import { setDemoLanguage, uiStrings } from "../src/renderer/strings";
import { createSettingsPanel, defaultSettings } from "../src/renderer/settings";
import { createSearchBar } from "../src/renderer/search-bar";
import { createOutlinePanel } from "../src/renderer/outline-panel";

function createMockEditor(): EditorAPI {
  return {
    getDocument: () => "",
    getTableOfContents: (): TocEntry[] => [],
    getSelection: () => ({ anchor: 0, head: 0 }),
    setSelection: () => {},
    focus: () => {},
    on: () => {},
    off: () => {},
  } as unknown as EditorAPI;
}

describe("demo chrome localization", () => {
  beforeEach(() => {
    setDemoLanguage("en");
    localStorage.clear();
  });

  it("switches demo chrome strings between languages", () => {
    expect(uiStrings().appOpen).toBe("Open");
    expect(uiStrings().settingsTitle).toBe("Settings");
    expect(uiStrings().backlinksTitle).toBe("Backlinks");

    setDemoLanguage("zh");
    expect(uiStrings().appOpen).toBe("打开");
    expect(uiStrings().appSave).toBe("保存");
    expect(uiStrings().settingsTitle).toBe("设置");
    expect(uiStrings().searchFind).toBe("查找...");
    expect(uiStrings().outlineTitle).toBe("大纲");
    expect(uiStrings().vaultTitle).toBe("仓库");
    expect(uiStrings().backlinksTitle).toBe("反向链接");
  });

  it("renders the settings panel in Chinese when the language is zh", () => {
    setDemoLanguage("zh");
    const panel = createSettingsPanel(defaultSettings(), () => {});
    document.body.append(panel.element);

    expect(panel.element.textContent).toContain("设置");
    expect(panel.element.textContent).toContain("显示");
    expect(panel.element.textContent).toContain("配色方案");
    expect(panel.element.textContent).toContain("行号");
    expect(panel.element.textContent).toContain("语言");

    panel.destroy();
  });

  it("renders the settings panel in English by default", () => {
    const panel = createSettingsPanel(defaultSettings(), () => {});
    document.body.append(panel.element);

    expect(panel.element.textContent).toContain("Settings");
    expect(panel.element.textContent).toContain("Display");
    expect(panel.element.textContent).toContain("Color scheme");

    panel.destroy();
  });

  it("renders search-bar placeholders in Chinese", () => {
    setDemoLanguage("zh");
    const bar = createSearchBar(createMockEditor());
    document.body.append(bar.element);

    const inputs = bar.element.querySelectorAll<HTMLInputElement>("input");
    expect(inputs[0].placeholder).toBe("查找...");
    expect(inputs[1].placeholder).toBe("替换...");

    bar.destroy();
  });

  it("renders the outline header in Chinese", () => {
    setDemoLanguage("zh");
    const outline = createOutlinePanel(createMockEditor());
    document.body.append(outline.element);

    expect(outline.element.textContent).toContain("大纲");
    outline.destroy();
  });
});
