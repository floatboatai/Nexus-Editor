/* eslint-disable max-lines */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEditor } from "@floatboat/nexus-core";
import type { ToolbarGroup } from "../src/index";
import { createToolbarUI } from "../src/index";

function press(target: Element, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

function toolbarButton(toolbar: HTMLElement, action: string): HTMLButtonElement {
  const button = toolbar.querySelector<HTMLButtonElement>(`[data-toolbar-action="${action}"]`);
  if (!button) throw new Error(`Missing toolbar button: ${action}`);
  return button;
}

function createFixture(initialValue = "Title") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({ container, initialValue });
  const toolbar = createToolbarUI(editor);
  document.body.appendChild(toolbar.element);
  return {
    container,
    editor,
    toolbar,
    destroy() {
      toolbar.destroy();
      editor.destroy();
      container.remove();
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});

describe("toolbar keyboard accessibility", () => {
  it("exposes toolbar semantics and one initial tab stop", () => {
    const fixture = createFixture();
    const buttons = Array.from(fixture.toolbar.element.querySelectorAll<HTMLButtonElement>(".nexus-toolbar-btn"));

    expect(fixture.toolbar.element.getAttribute("role")).toBe("toolbar");
    expect(fixture.toolbar.element.getAttribute("aria-label")).toBe("Formatting toolbar");
    expect(fixture.toolbar.element.getAttribute("aria-orientation")).toBe("horizontal");
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([buttons[0]]);
    expect(buttons.slice(1).every((button) => button.tabIndex === -1)).toBe(true);

    fixture.destroy();
  });

  it("navigates with arrows, wraps, and supports Home and End", () => {
    const fixture = createFixture();
    const buttons = Array.from(fixture.toolbar.element.querySelectorAll<HTMLButtonElement>(".nexus-toolbar-btn"));
    buttons[0]?.focus();

    press(buttons[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(buttons.at(-1));
    press(buttons.at(-1)!, "ArrowRight");
    expect(document.activeElement).toBe(buttons[0]);
    press(buttons[0]!, "End");
    expect(document.activeElement).toBe(buttons.at(-1));
    press(buttons.at(-1)!, "Home");
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons.filter((button) => button.tabIndex === 0)).toEqual([buttons[0]]);

    fixture.destroy();
  });

  it("keeps the clicked button as the roving tab stop", () => {
    const fixture = createFixture();
    const bold = toolbarButton(fixture.toolbar.element, "bold");
    fixture.editor.setSelection(0, 5);

    bold.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(bold.tabIndex).toBe(0);
    expect(fixture.toolbar.element.querySelectorAll('.nexus-toolbar-btn[tabindex="0"]')).toHaveLength(1);
    expect(fixture.editor.getDocument()).toBe("**Title**");
    fixture.destroy();
  });

  it("handles empty and single-button custom groups", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "text" });
    const action = vi.fn();
    const groups: ToolbarGroup[] = [
      { buttons: [] },
      { buttons: [{ id: "custom", title: "Custom", icon: () => document.createElement("span"), action }] },
      { buttons: [] },
    ];
    const toolbar = createToolbarUI(editor, { groups });
    document.body.appendChild(toolbar.element);
    const button = toolbarButton(toolbar.element, "custom");

    expect(button.tabIndex).toBe(0);
    button.focus();
    press(button, "ArrowRight");
    expect(document.activeElement).toBe(button);
    button.click();
    expect(action).toHaveBeenCalledOnce();

    toolbar.destroy();
    editor.destroy();
  });
});

describe("heading menu accessibility", () => {
  it("maintains trigger ARIA state and focuses the first menu item", () => {
    const fixture = createFixture();
    const trigger = toolbarButton(fixture.toolbar.element, "heading-menu");
    const popupId = trigger.getAttribute("aria-controls");

    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(popupId).toMatch(/^nexus-toolbar-overlay-/);

    press(trigger, "ArrowDown");
    const menu = document.getElementById(popupId!);
    const items = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(document.activeElement).toBe(items[0]);

    fixture.destroy();
  });

  it("opens with Enter or Space and repeated activation closes it", () => {
    const fixture = createFixture();
    const trigger = toolbarButton(fixture.toolbar.element, "heading-menu");
    const popupId = trigger.getAttribute("aria-controls")!;

    press(trigger, "Enter");
    expect(document.getElementById(popupId)).not.toBeNull();
    press(trigger, " ");
    expect(document.getElementById(popupId)).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    press(trigger, " ");
    expect(document.getElementById(popupId)).not.toBeNull();

    fixture.destroy();
  });

  it("navigates menu items and executes heading actions", () => {
    const fixture = createFixture();
    const trigger = toolbarButton(fixture.toolbar.element, "heading-menu");
    trigger.click();
    const items = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));

    press(items[0]!, "ArrowUp");
    expect(document.activeElement).toBe(items.at(-1));
    press(items.at(-1)!, "Home");
    expect(document.activeElement).toBe(items[0]);
    press(items[0]!, "End");
    expect(document.activeElement).toBe(items.at(-1));
    press(items.at(-1)!, "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    press(items[0]!, "Enter");

    expect(fixture.editor.getDocument()).toBe("# Title");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    fixture.destroy();
  });

  it("preserves the Normal text command", () => {
    const fixture = createFixture("## Title");
    fixture.editor.setSelection(5);
    toolbarButton(fixture.toolbar.element, "heading-menu").click();
    const normalText = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).at(-1)!;
    press(normalText, " ");

    expect(fixture.editor.getDocument()).toBe("Title");
    fixture.destroy();
  });

  it("restores trigger focus on Escape but not on Tab", () => {
    const fixture = createFixture();
    const trigger = toolbarButton(fixture.toolbar.element, "heading-menu");

    trigger.click();
    press(document.activeElement!, "Escape");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.click();
    press(document.activeElement!, "Tab");
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
    fixture.destroy();
  });

  it("closes on an outside pointer press", () => {
    const fixture = createFixture();
    const trigger = toolbarButton(fixture.toolbar.element, "heading-menu");
    trigger.click();

    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fixture.destroy();
  });
});

describe("color grid accessibility", () => {
  it("uses a labelled grid and navigates the ten-column text palette", () => {
    const fixture = createFixture();
    const trigger = toolbarButton(fixture.toolbar.element, "text-color");
    press(trigger, "ArrowDown");
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const rows = grid.querySelectorAll('[role="row"]');
    const cells = Array.from(grid.querySelectorAll<HTMLButtonElement>('[role="gridcell"]'));

    expect(trigger.getAttribute("aria-haspopup")).toBe("grid");
    expect(grid.getAttribute("aria-label")).toBe("Text color palette");
    expect(rows).toHaveLength(4);
    expect(cells[0]?.getAttribute("aria-label")).toBe("Text color #000000");
    expect(document.activeElement).toBe(cells[0]);

    press(cells[0]!, "ArrowRight");
    expect(document.activeElement).toBe(cells[1]);
    press(cells[1]!, "ArrowDown");
    expect(document.activeElement).toBe(cells[11]);
    press(cells[11]!, "End");
    expect(document.activeElement).toBe(cells[19]);
    press(cells[19]!, "Home");
    expect(document.activeElement).toBe(cells[10]);
    press(cells[10]!, "ArrowUp");
    expect(document.activeElement).toBe(cells[0]);
    press(cells[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(cells[0]);
    press(cells[0]!, "Escape");
    expect(document.querySelector('[role="grid"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    fixture.destroy();
  });

  it("uses the actual five-column highlight palette and preserves color commands", () => {
    const fixture = createFixture("hello");
    fixture.editor.setSelection(0, 5);
    const trigger = toolbarButton(fixture.toolbar.element, "highlight");
    trigger.click();
    const grid = document.querySelector<HTMLElement>('[role="grid"]')!;
    const cells = Array.from(grid.querySelectorAll<HTMLButtonElement>('[role="gridcell"]'));

    expect(grid.querySelectorAll('[role="row"]')).toHaveLength(4);
    expect(grid.getAttribute("aria-label")).toBe("Highlight color palette");
    press(cells[0]!, "ArrowDown");
    expect(document.activeElement).toBe(cells[5]);
    press(cells[5]!, "Enter");

    expect(fixture.editor.getDocument()).toBe('<mark style="background:#fce5cd">hello</mark>');
    expect(document.querySelector('[role="grid"]')).toBeNull();
    fixture.destroy();
  });

  it("applies text color with Space and returns focus to the editor", () => {
    const fixture = createFixture("hello");
    fixture.editor.setSelection(0, 5);
    toolbarButton(fixture.toolbar.element, "text-color").click();
    const firstCell = document.querySelector<HTMLButtonElement>('[role="gridcell"]')!;
    press(firstCell, " ");

    expect(fixture.editor.getDocument()).toBe('<span style="color:#000000">hello</span>');
    expect(document.querySelector('[role="grid"]')).toBeNull();
    expect(fixture.container.contains(document.activeElement)).toBe(true);
    fixture.destroy();
  });
});

describe("toolbar instance and lifecycle isolation", () => {
  it("keeps overlays from two toolbar instances independent", () => {
    const first = createFixture("first");
    const second = createFixture("second");
    const firstTrigger = toolbarButton(first.toolbar.element, "heading-menu");
    const secondTrigger = toolbarButton(second.toolbar.element, "text-color");

    firstTrigger.click();
    secondTrigger.click();
    const firstOverlay = document.getElementById(firstTrigger.getAttribute("aria-controls")!);
    const secondOverlay = document.getElementById(secondTrigger.getAttribute("aria-controls")!);
    expect(firstOverlay).not.toBeNull();
    expect(secondOverlay).not.toBeNull();
    expect(firstOverlay).not.toBe(secondOverlay);

    secondOverlay!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(firstOverlay?.isConnected).toBe(false);
    expect(secondOverlay?.isConnected).toBe(true);
    expect(secondTrigger.getAttribute("aria-expanded")).toBe("true");

    first.destroy();
    second.destroy();
  });

  it("mounts overlays inside the active fullscreen subtree", () => {
    const fixture = createFixture();
    const fullscreenHost = document.createElement("div");
    document.body.appendChild(fullscreenHost);
    fullscreenHost.appendChild(fixture.toolbar.element);
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: fullscreenHost });
    const trigger = toolbarButton(fixture.toolbar.element, "heading-menu");

    trigger.click();

    expect(document.getElementById(trigger.getAttribute("aria-controls")!)?.parentElement).toBe(fullscreenHost);
    fixture.destroy();
  });

  it("removes overlays, tooltips, and every registered global listener on destroy", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "text" });
    const windowAdd = vi.spyOn(window, "addEventListener");
    const windowRemove = vi.spyOn(window, "removeEventListener");
    const documentAdd = vi.spyOn(document, "addEventListener");
    const documentRemove = vi.spyOn(document, "removeEventListener");
    const toolbar = createToolbarUI(editor);
    document.body.appendChild(toolbar.element);
    const bold = toolbarButton(toolbar.element, "bold");
    bold.dispatchEvent(new MouseEvent("mouseenter"));
    toolbarButton(toolbar.element, "heading-menu").click();
    const globalRegistrations = windowAdd.mock.calls.filter(([type]) => type === "scroll" || type === "resize");
    const outsideRegistration = documentAdd.mock.calls.find(([type]) => type === "mousedown");

    toolbar.destroy();

    expect(document.querySelector(".nexus-toolbar-dropdown")).toBeNull();
    expect(document.querySelector(".nexus-toolbar-tooltip")).toBeNull();
    for (const registration of globalRegistrations) {
      expect(windowRemove.mock.calls).toContainEqual(registration);
    }
    expect(outsideRegistration).toBeDefined();
    expect(documentRemove.mock.calls).toContainEqual(outsideRegistration);
    editor.destroy();
  });

  it("supports repeated create and destroy without retained overlays", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "text" });

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const toolbar = createToolbarUI(editor);
      document.body.appendChild(toolbar.element);
      toolbarButton(toolbar.element, "highlight").click();
      expect(document.querySelectorAll(".nexus-toolbar-dropdown")).toHaveLength(1);
      toolbar.destroy();
      expect(document.querySelectorAll(".nexus-toolbar-dropdown")).toHaveLength(0);
    }

    editor.destroy();
  });
});
