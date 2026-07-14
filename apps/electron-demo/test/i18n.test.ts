import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMessages,
  loadLanguagePreference,
  resolveAppLanguage,
  resolvePreferredLanguage,
  saveLanguagePreference,
} from "../src/renderer/i18n";
import { createSettingsPanel, defaultSettings } from "../src/renderer/settings";

afterEach(() => {
  localStorage.clear();
});

describe("resolveAppLanguage", () => {
  it.each(["zh", "zh-CN", "zh-Hans", "ZH-TW"])(
    "uses Chinese for %s",
    (systemLanguage) => {
      expect(resolveAppLanguage(systemLanguage)).toBe("zh");
    }
  );

  it.each(["en", "en-US", "ja-JP", "fr-FR"])(
    "uses English for %s",
    (systemLanguage) => {
      expect(resolveAppLanguage(systemLanguage)).toBe("en");
    }
  );

  it("provides Chinese and English interface text", () => {
    expect(getMessages("zh").toolbar.open).toBe("打开");
    expect(getMessages("en").toolbar.open).toBe("Open");
  });

  it("uses an explicit preference instead of the system language", () => {
    expect(resolvePreferredLanguage("system", "zh-CN")).toBe("zh");
    expect(resolvePreferredLanguage("en", "zh-CN")).toBe("en");
    expect(resolvePreferredLanguage("zh", "en-US")).toBe("zh");
  });

  it("persists the language preference", () => {
    expect(loadLanguagePreference()).toBe("system");
    saveLanguagePreference("zh");
    expect(loadLanguagePreference()).toBe("zh");
  });

  it("shows system, Chinese, and English in settings", () => {
    const panel = createSettingsPanel(defaultSettings(), vi.fn(), vi.fn(() => true));
    const select = panel.element.querySelector("select");

    expect(Array.from(select?.options ?? []).map((option) => option.value)).toEqual([
      "system",
      "zh",
      "en",
    ]);
    panel.destroy();
  });
});
