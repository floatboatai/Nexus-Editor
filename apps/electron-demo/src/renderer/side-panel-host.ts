import type { ProductViewSurface } from "./product-ui-owner";

export interface SidePanelHost {
  readonly element: HTMLElement;
  mount(surface: ProductViewSurface, element: HTMLElement): void;
  unmount(surface: ProductViewSurface): void;
  setVisible(surface: ProductViewSurface, visible: boolean): void;
  toggle(surface: ProductViewSurface): boolean;
  isVisible(surface: ProductViewSurface): boolean;
  destroy(): void;
}

/**
 * Owns the two product panels as one layout unit.
 *
 * The host deliberately owns only mounting and visibility. Each panel remains
 * responsible for its own rendering lifecycle through ProductViewResource.
 */
export function createSidePanelHost(ownerDocument: Document): SidePanelHost {
  const element = ownerDocument.createElement("div");
  element.className = "nexus-side-panel-host";
  element.dataset.nexusSidePanelHost = "right";
  element.setAttribute("role", "group");
  element.setAttribute("aria-label", "Reference panels");
  element.hidden = true;

  const panels = new Map<ProductViewSurface, HTMLElement>();
  let destroyed = false;

  function assertActive(): void {
    if (destroyed) throw new Error("Side panel host is destroyed");
  }

  function requirePanel(surface: ProductViewSurface): HTMLElement {
    assertActive();
    const panel = panels.get(surface);
    if (!panel) throw new Error(`Side panel '${surface}' is not mounted`);
    return panel;
  }

  function syncHostVisibility(): void {
    const visible: ProductViewSurface[] = [];
    for (const [surface, panel] of panels) {
      if (!panel.hidden) visible.push(surface);
    }
    element.hidden = visible.length === 0;
    element.dataset.visiblePanels = visible.join(" ");
  }

  return {
    element,
    mount(surface, panel) {
      assertActive();
      if (panels.has(surface)) {
        throw new Error(`Side panel '${surface}' is already mounted`);
      }
      for (const [mountedSurface, mountedPanel] of panels) {
        if (mountedPanel === panel) {
          throw new Error(`Side panel element is already mounted as '${mountedSurface}'`);
        }
      }
      if (panel.ownerDocument !== ownerDocument) {
        throw new Error(`Side panel '${surface}' belongs to another document`);
      }
      panel.dataset.nexusProductSurface = surface;
      if (!panel.hasAttribute("role")) panel.setAttribute("role", "complementary");
      if (!panel.hasAttribute("aria-label")) {
        panel.setAttribute("aria-label", surface === "outline" ? "Outline" : "Backlinks");
      }
      panel.hidden = false;
      panels.set(surface, panel);
      element.append(panel);
      syncHostVisibility();
    },
    unmount(surface) {
      const panel = panels.get(surface);
      if (!panel) return;
      panels.delete(surface);
      if (panel.parentElement === element) panel.remove();
      syncHostVisibility();
    },
    setVisible(surface, visible) {
      const panel = requirePanel(surface);
      panel.hidden = !visible;
      syncHostVisibility();
    },
    toggle(surface) {
      const panel = requirePanel(surface);
      const visible = panel.hidden;
      panel.hidden = !visible;
      syncHostVisibility();
      return visible;
    },
    isVisible(surface) {
      return !requirePanel(surface).hidden;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      panels.clear();
      element.replaceChildren();
      element.remove();
    },
  };
}
