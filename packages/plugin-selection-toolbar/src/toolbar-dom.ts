import type { EditorAPI } from "@floatboat/nexus-core";

export interface SelectionToolbarButton {
  id: string;
  title: string;
  icon: () => HTMLElement;
  /** The source button anchors host-owned popovers; abort closes pending UI. */
  action: (editor: EditorAPI, signal: AbortSignal, anchor: HTMLButtonElement) => void;
}

export interface SelectionToolbarGroup {
  buttons: SelectionToolbarButton[];
}

const BUTTON_STYLES = `
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--nexus-text-muted, #888);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
`;

export const SEPARATOR_STYLES = `
  width: 1px;
  height: 18px;
  background: var(--nexus-border-subtle, #ddd);
  margin: 0 4px;
  flex-shrink: 0;
`;

let tooltipId = 0;

/**
 * Pick an overlay mount target that stays visible under the HTML Fullscreen API.
 * The Fullscreen API only renders the fullscreen element subtree; anything
 * appended to `document.body` outside that subtree is hidden behind the
 * fullscreen backdrop. So when the toolbar (or its anchor button) lives inside
 * a fullscreen element, mount overlays into that element instead.
 */
export function pickOverlayMount(anchor: HTMLElement | Document): HTMLElement {
  const isDocument = anchor.nodeType === 9;
  const doc = (isDocument ? anchor : anchor.ownerDocument) as Document;
  const node = isDocument ? null : anchor as HTMLElement;
  const fullscreenEl = doc.fullscreenElement as HTMLElement | null;
  if (fullscreenEl && (!node || fullscreenEl.contains(node))) return fullscreenEl;
  return doc.body;
}

function positionToolbarTooltip(button: HTMLElement, tooltip: HTMLElement): void {
  const rect = button.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.bottom + 8}px`;
}

function installToolbarTooltip(button: HTMLButtonElement) {
  const document = button.ownerDocument;
  const window = document.defaultView!;
  const tooltip = document.createElement("div");
  tooltip.className = "nexus-selection-toolbar-tooltip";
  tooltip.id = `nexus-selection-toolbar-tooltip-${++tooltipId}`;
  tooltip.setAttribute("role", "tooltip");
  tooltip.style.cssText = `
    position: fixed;
    transform: translateX(-50%);
    padding: 5px 8px;
    border-radius: 5px;
    background: var(--nexus-text, #24292e);
    color: var(--nexus-bg, #fff);
    font: 12px system-ui, sans-serif;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10001;
  `;
  button.setAttribute("aria-describedby", tooltip.id);

  const show = () => {
    const label = button.dataset.toolbarTooltip ?? button.getAttribute("aria-label") ?? "";
    if (!label.trim()) return;
    tooltip.textContent = label;
    tooltip.dataset.state = "open";
    if (!tooltip.isConnected) pickOverlayMount(button).appendChild(tooltip);
    positionToolbarTooltip(button, tooltip);
  };
  const hide = () => {
    tooltip.dataset.state = "closed";
    tooltip.remove();
  };
  const updatePosition = () => {
    if (tooltip.isConnected) positionToolbarTooltip(button, tooltip);
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") hide();
  };

  button.addEventListener("mouseenter", show);
  button.addEventListener("focus", show);
  button.addEventListener("mouseleave", hide);
  button.addEventListener("blur", hide);
  button.addEventListener("click", hide);
  button.addEventListener("keydown", handleKeyDown);
  window.addEventListener("scroll", updatePosition, true);
  window.addEventListener("resize", updatePosition);

  return {
    hide,
    destroy() {
      button.removeEventListener("mouseenter", show);
      button.removeEventListener("focus", show);
      button.removeEventListener("mouseleave", hide);
      button.removeEventListener("blur", hide);
      button.removeEventListener("click", hide);
      button.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      hide();
    },
  };
}

/** Local button rendering; action ownership stays with the selection controller. */
export function createToolbarButton(document: Document, definition: SelectionToolbarButton) {
  const button = document.createElement("button");
  button.className = "nexus-toolbar-btn";
  button.dataset.toolbarAction = definition.id;
  button.dataset.toolbarTooltip = definition.title;
  button.setAttribute("aria-label", definition.title);
  button.type = "button";
  button.tabIndex = -1;
  button.style.cssText = BUTTON_STYLES;
  button.appendChild(definition.icon());
  const tooltip = installToolbarTooltip(button);
  const enter = () => {
    button.style.background = "var(--nexus-bg-muted, #f0f0f0)";
    button.style.color = "var(--nexus-text, #24292e)";
  };
  const leave = () => {
    button.style.background = "transparent";
    button.style.color = "var(--nexus-text-muted, #888)";
  };
  button.addEventListener("mouseenter", enter);
  button.addEventListener("mouseleave", leave);
  return {
    button,
    hideTooltip: tooltip.hide,
    destroy() {
      tooltip.destroy();
      button.removeEventListener("mouseenter", enter);
      button.removeEventListener("mouseleave", leave);
    },
  };
}
