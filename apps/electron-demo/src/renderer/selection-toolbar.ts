import { applyTextColor, insertLink, toggleInlineCode } from "@floatboat/nexus-plugin-formatting";
import type { SelectionToolbarButton, SelectionToolbarGroup, SelectionToolbarLifecyclePluginOptions } from "@floatboat/nexus-plugin-selection-toolbar";

function icon(paths: string): () => HTMLElement {
  return () => {
    const element = document.createElement("span");
    element.setAttribute("aria-hidden", "true");
    element.style.cssText = "display:flex;align-items:center;justify-content:center;width:18px;height:18px;";
    element.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
    return element;
  };
}

const LINK_BUTTON = { id: "link", title: "Insert link", icon: icon('<path d="M7 11l4-4M6.5 6.5l1.8-1.8a3.5 3.5 0 015 5l-1.8 1.8M11.5 11.5l-1.8 1.8a3.5 3.5 0 01-5-5l1.8-1.8"/>') };
const INLINE_CODE_BUTTON = { id: "inline-code", title: "Inline code", icon: icon('<polyline points="6 5 2 9 6 13"/><polyline points="12 5 16 9 12 13"/>') };
const TEXT_COLORS = [
  ["Default", "inherit"], ["Gray", "#6b7280"], ["Red", "#dc2626"], ["Orange", "#ea580c"],
  ["Yellow", "#ca8a04"], ["Green", "#16a34a"], ["Blue", "#2563eb"], ["Purple", "#9333ea"],
] as const;

const chooseTextColor: SelectionToolbarButton["action"] = (editor, signal, anchor) => new Promise<void>((resolve) => {
  const document = anchor.ownerDocument;
  const window = document.defaultView!;
  const panel = document.createElement("div");
  panel.className = "nexus-selection-color-picker";
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Text color");
  panel.style.cssText = "position:fixed;margin:0;padding:8px;border:1px solid var(--nexus-border,#ddd);border-radius:8px;background:var(--nexus-bg,#fff);color:var(--nexus-text,#24292e);box-shadow:0 4px 16px #0002;";
  const grid = document.createElement("div");
  grid.style.cssText = "display:grid;grid-template-columns:repeat(4,30px);gap:6px;";
  panel.appendChild(grid);
  const swatches = TEXT_COLORS.map(([name, color]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", name);
    button.title = name;
    button.dataset.color = color;
    button.style.cssText = `width:30px;height:30px;border:1px solid var(--nexus-border,#ddd);border-radius:5px;background:${color === "inherit" ? "var(--nexus-text,#24292e)" : color};cursor:pointer;`;
    button.addEventListener("click", () => {
      if (!signal.aborted) applyTextColor(editor, color);
      finish();
    });
    grid.appendChild(button);
    return button;
  });
  function position() {
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    const below = rect.bottom + 8;
    panel.style.top = `${Math.max(8, below + panel.offsetHeight <= window.innerHeight - 8 ? below : rect.top - panel.offsetHeight - 8)}px`;
  }
  function finish() {
    signal.removeEventListener("abort", finish);
    window.removeEventListener("scroll", finish, true);
    window.removeEventListener("resize", position);
    panel.removeEventListener("toggle", onToggle);
    panel.remove();
    anchor.removeAttribute("aria-expanded");
    if (!signal.aborted) anchor.focus();
    resolve();
  }
  function onToggle(event: ToggleEvent) {
    if (event.newState === "closed") finish();
  }
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      finish();
      return;
    }
    const index = swatches.indexOf(document.activeElement as HTMLButtonElement);
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[event.key];
    if (delta !== undefined || event.key === "Tab") {
      event.preventDefault();
      swatches[(index + (delta ?? (event.shiftKey ? -1 : 1)) + swatches.length) % swatches.length].focus();
    }
  });
  signal.addEventListener("abort", finish, { once: true });
  panel.addEventListener("toggle", onToggle);
  window.addEventListener("scroll", finish, true);
  window.addEventListener("resize", position);
  anchor.setAttribute("aria-haspopup", "dialog");
  anchor.setAttribute("aria-expanded", "true");
  // Keep the panel in the source toolbar's subtree for focus and outside-click ownership.
  // The popover top layer prevents the toolbar's viewport clipping from cutting it off.
  anchor.parentElement!.appendChild(panel);
  panel.showPopover();
  position();
  swatches[0].focus();
});

const COLOR_BUTTON = {
  id: "text-color", title: "Text color",
  icon: icon('<path d="M5 12l4-9 4 9M6.5 9h5"/><path d="M3 16h12" stroke="#2563eb" stroke-width="3"/>'),
  action: chooseTextColor,
};

/** Host-selected presentation and actions; the UI plugin has no formatting dependency. */
export function createSelectionToolbarGroups(): SelectionToolbarGroup[] {
  return [
    { buttons: [{ ...LINK_BUTTON, action: insertLink }, { ...INLINE_CODE_BUTTON, action: toggleInlineCode }] },
    { buttons: [COLOR_BUTTON] },
  ];
}

export function createSelectionToolbarRuntimeGroups(): NonNullable<SelectionToolbarLifecyclePluginOptions["groups"]> {
  return [
    { buttons: [{ ...LINK_BUTTON, commandId: "formatting:link" }, { ...INLINE_CODE_BUTTON, commandId: "formatting:inline-code" }] },
    { buttons: [COLOR_BUTTON] },
  ];
}
