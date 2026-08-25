import { afterEach, describe, expect, it } from "vitest";

import { createSidePanelHost } from "../src/renderer/side-panel-host";

afterEach(() => {
  document.body.replaceChildren();
});

describe("SidePanelHost", () => {
  it("groups product panels and hides only when both surfaces are closed", () => {
    const host = createSidePanelHost(document);
    const outline = document.createElement("section");
    const backlinks = document.createElement("section");
    document.body.append(host.element);

    expect(host.element.hidden).toBe(true);
    host.mount("outline", outline);
    host.mount("backlinks", backlinks);

    expect(host.element.hidden).toBe(false);
    expect(Array.from(host.element.children)).toEqual([outline, backlinks]);
    expect(host.element.dataset.visiblePanels).toBe("outline backlinks");
    expect(host.element.getAttribute("role")).toBe("group");
    expect(outline.getAttribute("aria-label")).toBe("Outline");
    expect(backlinks.getAttribute("aria-label")).toBe("Backlinks");

    host.setVisible("outline", false);
    expect(outline.hidden).toBe(true);
    expect(host.element.hidden).toBe(false);
    expect(host.element.dataset.visiblePanels).toBe("backlinks");

    host.setVisible("backlinks", false);
    expect(host.element.hidden).toBe(true);

    expect(host.toggle("outline")).toBe(true);
    expect(host.element.hidden).toBe(false);
    expect(host.isVisible("outline")).toBe(true);

    host.destroy();
    expect(host.element.isConnected).toBe(false);
  });

  it("rejects duplicate and cross-document mounts", () => {
    const host = createSidePanelHost(document);
    const outline = document.createElement("section");
    host.mount("outline", outline);

    expect(() => host.mount("outline", document.createElement("section")))
      .toThrow("already mounted");
    expect(() => host.mount("backlinks", outline)).toThrow("already mounted as 'outline'");
    const foreign = document.implementation.createHTMLDocument().createElement("section");
    expect(() => host.mount("backlinks", foreign)).toThrow("another document");

    host.unmount("outline");
    expect(host.element.hidden).toBe(true);
    host.destroy();
    expect(host.element.childElementCount).toBe(0);
  });
});
