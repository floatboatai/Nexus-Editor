import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsPanel, defaultSettings, loadSettings, saveSettings } from "../src/renderer/settings";

function findLanguageSelect(panel: HTMLElement): HTMLSelectElement {
  const select = Array.from(panel.querySelectorAll<HTMLSelectElement>("select")).find((s) =>
    Array.from(s.options).some((o) => o.value === "zh")
  );
  if (!select) throw new Error("language select not found");
  return select;
}

describe("language setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists the selection and reports it through onChange", () => {
    const onChange = vi.fn();
    const panel = createSettingsPanel(defaultSettings(), onChange);
    document.body.append(panel.element);

    const select = findLanguageSelect(panel.element);
    expect(select.value).toBe("en");

    select.value = "zh";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(loadSettings().language).toBe("zh");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ language: "zh" }));

    panel.destroy();
  });

  it("round-trips language through save/load", () => {
    saveSettings({ ...defaultSettings(), language: "zh" });
    expect(loadSettings().language).toBe("zh");
  });
});
