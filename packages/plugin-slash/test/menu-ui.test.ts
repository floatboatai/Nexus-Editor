import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorAPI, type SlashCommandDef } from "@floatboat/nexus-core";
import { createSlashMenuUI, type SlashMenuUI } from "../src/menu-ui";

const PREFIX = "nexus-slash";

interface Harness {
  editor: EditorAPI;
  menu: SlashMenuUI;
  container: HTMLDivElement;
  destroy(): void;
}

function setup(
  commands: SlashCommandDef[],
  options: Parameters<typeof createSlashMenuUI>[1] = {}
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
  });
  const menu = createSlashMenuUI(editor, options);

  return {
    editor,
    menu,
    container,
    destroy() {
      menu.destroy();
      editor.destroy();
      container.remove();
    },
  };
}

function open(editor: EditorAPI, query: string): void {
  // Setting the document programmatically goes through the same
  // updateListener as user typing, so the slashMenuChange event fires
  // with the new state.
  editor.setDocument(`/${query}`);
  editor.setSelection(query.length + 1);
}

function items(menu: SlashMenuUI): HTMLElement[] {
  return Array.from(
    menu.element.querySelectorAll<HTMLElement>(`.${PREFIX}-menu__item`)
  );
}

function activeItem(menu: SlashMenuUI): HTMLElement | null {
  return menu.element.querySelector<HTMLElement>(`.${PREFIX}-menu__item.is-active`);
}

function pressKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(e);
  return e;
}

const baseCommands: SlashCommandDef[] = [
  { id: "h1", title: "Heading 1", keywords: ["h1", "title"] },
  { id: "h2", title: "Heading 2", keywords: ["h2"] },
  { id: "bold", title: "Bold", keywords: ["strong"] },
];

describe("createSlashMenuUI lifecycle", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("mounts hidden by default", () => {
    h = setup(baseCommands);
    expect(h.menu.element.parentElement).toBe(document.body);
    expect(h.menu.element.style.display).toBe("none");
  });

  it("opens when a slash query yields matching commands", () => {
    h = setup(baseCommands);
    open(h.editor, "he");
    expect(h.menu.element.style.display).toBe("block");
    expect(items(h.menu)).toHaveLength(2);
  });

  it("renders an empty-state node when the query has no matches", () => {
    h = setup(baseCommands);
    open(h.editor, "zzz");
    expect(h.menu.element.style.display).toBe("block");
    expect(items(h.menu)).toHaveLength(0);
    expect(h.menu.element.querySelector(`.${PREFIX}-menu__empty`)?.textContent).toBe(
      "No matches"
    );
  });

  it("hides when the trigger disappears", () => {
    h = setup(baseCommands);
    open(h.editor, "he");
    expect(h.menu.element.style.display).toBe("block");
    // Replace the slash with plain text — closes the menu.
    h.editor.setDocument("hello");
    h.editor.setSelection(5);
    expect(h.menu.element.style.display).toBe("none");
  });

  it("destroy detaches the element and stops reacting", () => {
    h = setup(baseCommands);
    open(h.editor, "he");
    expect(h.menu.element.parentElement).toBe(document.body);
    h.menu.destroy();
    expect(h.menu.element.parentElement).toBeNull();
    // Should be safe to dispatch more events without throwing.
    expect(() => open(h.editor, "bo")).not.toThrow();
  });

  it("supports a custom container", () => {
    const customRoot = document.createElement("div");
    document.body.appendChild(customRoot);
    h = setup(baseCommands, { container: customRoot });
    expect(h.menu.element.parentElement).toBe(customRoot);
    customRoot.remove();
  });
});

describe("createSlashMenuUI rendering", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("highlights the first item by default", () => {
    h = setup(baseCommands);
    open(h.editor, "h");
    const active = activeItem(h.menu);
    expect(active).not.toBeNull();
    expect(active?.dataset.slashCommandId).toBe("h1");
    expect(active?.getAttribute("aria-selected")).toBe("true");
  });

  it("exposes aria-activedescendant on the listbox root", () => {
    h = setup(baseCommands);
    open(h.editor, "h");
    const activeId = activeItem(h.menu)?.id;
    expect(activeId).toBeTruthy();
    expect(h.menu.element.getAttribute("aria-activedescendant")).toBe(activeId);
    expect(h.menu.element.getAttribute("role")).toBe("listbox");
  });

  it("renders title and description, hiding the description when absent", () => {
    h = setup([
      { id: "with-desc", title: "Has description", description: "Useful note" },
      { id: "no-desc", title: "No description" },
    ]);
    open(h.editor, "");
    const [withDesc, noDesc] = items(h.menu);
    expect(withDesc.querySelector(`.${PREFIX}-menu__title`)?.textContent).toBe(
      "Has description"
    );
    expect(withDesc.querySelector<HTMLElement>(`.${PREFIX}-menu__description`)?.textContent).toBe(
      "Useful note"
    );
    expect(
      noDesc.querySelector<HTMLElement>(`.${PREFIX}-menu__description`)?.style.display
    ).toBe("none");
  });

  it("clamps the highlight when the command list shrinks below it", () => {
    h = setup(baseCommands);
    open(h.editor, "h"); // 2 items: Heading 1, Heading 2
    pressKey("ArrowDown");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("h2");
    // Narrow the query to "1" — only "Heading 1" contains it (Heading
    // 2 has no "1" anywhere in its title or keywords).
    open(h.editor, "1");
    expect(items(h.menu)).toHaveLength(1);
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("h1");
  });
});

describe("createSlashMenuUI keyboard navigation", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("ArrowDown moves the highlight forward", () => {
    h = setup(baseCommands);
    open(h.editor, "");
    pressKey("ArrowDown");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("h2");
    pressKey("ArrowDown");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("bold");
  });

  it("ArrowUp from the first item wraps to the last", () => {
    h = setup(baseCommands);
    open(h.editor, "");
    pressKey("ArrowUp");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("bold");
  });

  it("Home and End jump to the boundaries", () => {
    h = setup(baseCommands);
    open(h.editor, "");
    pressKey("End");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("bold");
    pressKey("Home");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("h1");
  });

  it("Escape dismisses without invoking run", () => {
    const run = vi.fn();
    h = setup([{ id: "x", title: "X", run }]);
    open(h.editor, "");
    pressKey("Escape");
    expect(h.menu.element.style.display).toBe("none");
    expect(run).not.toHaveBeenCalled();
    expect(h.editor.getDocument()).toBe("/");
  });

  it("Escape latches within the same trigger session", () => {
    h = setup(baseCommands);
    open(h.editor, "he");
    pressKey("Escape");
    expect(h.menu.element.style.display).toBe("none");
    // Moving the caret inside the trigger range still emits open
    // state from core, but the menu stays dismissed because we never
    // transitioned out of the open state.
    h.editor.setSelection(2);
    h.editor.setSelection(3);
    expect(h.menu.element.style.display).toBe("none");
  });

  it("dismiss latch resets when a new trigger session begins", () => {
    h = setup(baseCommands);
    open(h.editor, "");
    pressKey("Escape");
    // Replace doc with non-trigger text, then a new slash trigger.
    h.editor.setDocument("hi");
    h.editor.setSelection(2);
    expect(h.menu.element.style.display).toBe("none");
    open(h.editor, "");
    expect(h.menu.element.style.display).toBe("block");
  });
});

describe("createSlashMenuUI command execution", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("Enter removes the /query trigger and invokes run", () => {
    const run = vi.fn();
    h = setup([{ id: "h1", title: "Heading 1", run }], {});
    open(h.editor, "head");
    pressKey("Enter");

    expect(run).toHaveBeenCalledTimes(1);
    // /head was replaced by ""
    expect(h.editor.getDocument()).toBe("");
    expect(h.menu.element.style.display).toBe("none");
  });

  it("Tab is an alias for Enter", () => {
    const run = vi.fn();
    h = setup([{ id: "h1", title: "Heading 1", run }], {});
    open(h.editor, "head");
    pressKey("Tab");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("invokes onCommand override instead of run when provided", () => {
    const run = vi.fn();
    const onCommand = vi.fn();
    h = setup([{ id: "h1", title: "Heading 1", run }], { onCommand });
    open(h.editor, "head");
    pressKey("Enter");

    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    const [cmd, ctx] = onCommand.mock.calls[0];
    expect(cmd.id).toBe("h1");
    expect(ctx.trigger.query).toBe("head");
    expect(ctx.editor).toBe(h.editor);
  });

  it("silently no-ops when neither run nor onCommand is set", () => {
    h = setup([{ id: "h1", title: "Heading 1" }]);
    open(h.editor, "");
    expect(() => pressKey("Enter")).not.toThrow();
    // Trigger was still removed.
    expect(h.editor.getDocument()).toBe("");
  });

  it("clicking an item confirms it", () => {
    const run = vi.fn();
    h = setup([{ id: "h1", title: "Heading 1", run }]);
    open(h.editor, "head");
    items(h.menu)[0].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("hovering an item moves the highlight", () => {
    h = setup(baseCommands);
    open(h.editor, "");
    items(h.menu)[2].dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("bold");
  });
});

describe("createSlashMenuUI document interactions", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("dismisses on a mousedown outside the menu", () => {
    h = setup(baseCommands);
    open(h.editor, "");
    expect(h.menu.element.style.display).toBe("block");
    const elsewhere = document.createElement("button");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(h.menu.element.style.display).toBe("none");
    elsewhere.remove();
  });

  it("ignores mousedown inside the menu element", () => {
    h = setup(baseCommands);
    open(h.editor, "");
    items(h.menu)[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(h.menu.element.style.display).toBe("block");
  });

  it("suppresses keyboard handling during composition", () => {
    const run = vi.fn();
    h = setup([{ id: "h1", title: "Heading 1", run }]);
    open(h.editor, "head");
    document.dispatchEvent(new Event("compositionstart"));
    pressKey("Enter");
    expect(run).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("compositionend"));
    pressKey("Enter");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("Enter on an empty result list dismisses but does not throw", () => {
    h = setup(baseCommands);
    open(h.editor, "zzz");
    expect(items(h.menu)).toHaveLength(0);
    expect(() => pressKey("Enter")).not.toThrow();
    expect(h.menu.element.style.display).toBe("none");
  });

  it("does not steal keys when the menu is closed", () => {
    h = setup(baseCommands);
    // Menu has never opened, so Tab should be free for the editor.
    const e = pressKey("Tab");
    expect(e.defaultPrevented).toBe(false);
  });
});
