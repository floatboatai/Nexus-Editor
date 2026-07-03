import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";
import { createPreviewPane } from "../src/renderer/preview-pane";
import { defaultSettings } from "../src/renderer/settings";

function setup(initialValue = "# Title\n\nbody text\n") {
  const container = document.createElement("div");
  const editor = createEditor({ container, initialValue });
  const pane = createPreviewPane({ editor, settings: defaultSettings() });
  document.body.appendChild(pane.element);
  return { editor, pane };
}

describe("createPreviewPane", () => {
  it("starts hidden and renders source-mapped HTML on show", () => {
    const { editor, pane } = setup();

    expect(pane.element.hidden).toBe(true);
    expect(pane.element.querySelector("h1")).toBeNull();

    pane.setVisible(true);

    expect(pane.element.hidden).toBe(false);
    const h1 = pane.element.querySelector("h1");
    expect(h1?.textContent).toBe("Title");
    expect(h1?.hasAttribute("data-nexus-from")).toBe(true);

    pane.destroy();
    editor.destroy();
  });

  it("re-renders on editor change events", async () => {
    const { editor, pane } = setup();
    pane.setVisible(true);

    editor.setDocument("# Updated\n");

    expect(pane.element.querySelector("h1")?.textContent).toBe("Updated");
    pane.destroy();
    editor.destroy();
  });

  it("defers rendering while hidden and catches up on show", () => {
    const { editor, pane } = setup();

    editor.setDocument("# Deferred\n");
    expect(pane.element.querySelector("h1")).toBeNull();

    pane.setVisible(true);
    expect(pane.element.querySelector("h1")?.textContent).toBe("Deferred");

    pane.destroy();
    editor.destroy();
  });

  it("render() refreshes silent document loads that skip change events", () => {
    const { editor, pane } = setup();
    pane.setVisible(true);
    expect(pane.element.querySelector("h1")?.textContent).toBe("Title");

    editor.setDocument("# From Disk\n", { silent: true });
    // No change event fired — the pane still shows the old document...
    expect(pane.element.querySelector("h1")?.textContent).toBe("Title");
    // ...until the host refreshes it explicitly (app.ts does this on file open).
    pane.render();
    expect(pane.element.querySelector("h1")?.textContent).toBe("From Disk");

    pane.destroy();
    editor.destroy();
  });

  it("applies theme variables from settings", () => {
    const { editor, pane } = setup();

    pane.applySettings({ ...defaultSettings(), colorScheme: "dark" });

    expect(pane.element.style.getPropertyValue("--nexus-bg")).toBe("#1e1e1e");
    pane.destroy();
    editor.destroy();
  });

  it("detaches from the editor on destroy", () => {
    const { editor, pane } = setup();
    pane.setVisible(true);
    pane.destroy();

    expect(() => editor.setDocument("# After Destroy\n")).not.toThrow();
    expect(document.body.contains(pane.element)).toBe(false);
    editor.destroy();
  });
});
