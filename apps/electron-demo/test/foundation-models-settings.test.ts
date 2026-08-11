import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSettingsPanel,
  defaultSettings,
  loadSettings,
  type EditorSettings,
} from "../src/renderer/settings";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => {
      storage.delete(key);
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
  },
});

function loadSettingsAfterPersist(partial: Partial<EditorSettings>): EditorSettings {
  localStorage.setItem("nexus-editor-settings", JSON.stringify(partial));
  return loadSettings();
}

function renderSettings(options: Parameters<typeof createSettingsPanel>[2]): string {
  const panel = createSettingsPanel(defaultSettings(), vi.fn(), options);
  const text = panel.element.textContent ?? "";
  panel.destroy();
  return text;
}

describe("Foundation Models settings", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("enables Foundation Models suggestions by default", () => {
    expect(defaultSettings().foundationModelsSuggestions).toBe(true);
  });

  it("preserves a persisted disabled Foundation Models suggestion setting", () => {
    const loaded = loadSettingsAfterPersist({ foundationModelsSuggestions: false });

    expect(loaded.foundationModelsSuggestions).toBe(false);
  });

  it("hides the Foundation Models row outside macOS", () => {
    expect(renderSettings({ platform: "linux", availability: null })).not.toContain("Foundation Models");
  });

  it("renders an unavailable macOS row with reason text without mutating settings", () => {
    const onChange = vi.fn();
    const panel = createSettingsPanel(defaultSettings(), onChange, {
      platform: "darwin",
      availability: { available: false, platform: "macos", minimumOS: "26.0", reason: "unsupported-os" },
      enabled: true,
    });

    expect(panel.element.textContent).toContain("requires macOS 26");
    panel.element
      .querySelector<HTMLButtonElement>("[aria-label='Foundation Models suggestions unavailable']")
      ?.click();

    expect(onChange).not.toHaveBeenCalled();
    expect(localStorage.getItem("nexus-editor-settings")).toBeNull();
    panel.destroy();
  });

  it("persists available macOS toggle changes", () => {
    const onChange = vi.fn();
    const panel = createSettingsPanel(defaultSettings(), onChange, {
      platform: "darwin",
      availability: { available: true, platform: "macos", minimumOS: "26.0" },
      enabled: true,
    });

    const toggle = panel.element.querySelector<HTMLButtonElement>("[aria-label='Foundation Models suggestions']");
    expect(toggle).not.toBeNull();
    toggle?.click();

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ foundationModelsSuggestions: false }));
    expect(JSON.parse(localStorage.getItem("nexus-editor-settings") ?? "{}")).toMatchObject({
      foundationModelsSuggestions: false,
    });
    panel.destroy();
  });
});
