import { describe, expect, it, vi } from "vitest";
import { openNexusSearchPanel } from "@floatboat/nexus-plugin-search";
import { createEditorShell } from "../src/renderer/editor-shell";
import { createState } from "../src/renderer/state";
import { defaultSettings } from "../src/renderer/settings";

describe("open plugin search (Ctrl+F)", () => {
  it("opens the fuzzy-capable search panel with a single open call", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const shell = createEditorShell({
      container,
      state: createState(),
      settings: defaultSettings(),
      onStateChange: vi.fn()
    });

    try {
      shell.editor.focus();
      expect(openNexusSearchPanel(container)).toBe(true);

      const panel = container.querySelector('[data-test-id="markdown-search-bar"]');
      expect(panel).not.toBeNull();
      expect(panel!.querySelector('[data-test-id="markdown-search-fuzzy-toggle"]')).not.toBeNull();
    } finally {
      shell.destroy();
      container.remove();
    }
  });
});
