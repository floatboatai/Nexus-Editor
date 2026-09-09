import { beforeEach, describe, expect, it } from "vitest";

import { createI18n, normalizeLocale } from "../src/renderer/i18n";
import { loadSettings } from "../src/renderer/settings";

describe("Electron demo localization", () => {
  beforeEach(() => localStorage.clear());

  it("switches catalog text and interpolates values", () => {
    const i18n = createI18n("en");
    expect(i18n.t("app.save")).toBe("Save");

    i18n.setLocale("zh-CN");
    expect(i18n.t("app.save")).toBe("保存");
    expect(i18n.t("status.words", { count: 3 })).toBe("3 个词");
  });

  it("falls back to English for unsupported locale values", () => {
    expect(normalizeLocale("fr")).toBe("en");
    expect(createI18n("fr").t("settings.title")).toBe("Settings");
  });

  it("loads old settings and normalizes an invalid saved locale", () => {
    localStorage.setItem("nexus-editor-settings", JSON.stringify({ fontSize: 19, locale: "fr" }));
    expect(loadSettings()).toMatchObject({ fontSize: 19, locale: "en" });
  });
});
