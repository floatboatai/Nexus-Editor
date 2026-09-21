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
  options: Parameters<typeof createSlashMenuUI>[1] = {},
  editorOptions: Partial<Parameters<typeof createEditor>[0]> = {}
): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const editor = createEditor({
    container,
    initialValue: "",
    plugins: [{ name: "test", slashCommands: commands }],
    ...editorOptions,
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

function itemIds(menu: SlashMenuUI): string[] {
  return items(menu).map((item) => item.dataset.slashCommandId ?? "");
}

function itemById(menu: SlashMenuUI, id: string): HTMLElement {
  const item = items(menu).find((candidate) => candidate.dataset.slashCommandId === id);
  if (!item) throw new Error(`Missing slash command item: ${id}`);
  return item;
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

interface SlashHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

type SlashHistoryOptions =
  | boolean
  | {
      storage?: SlashHistoryStorage;
      storageKey?: string;
      maxEntries?: number;
    };

function withHistory(history: SlashHistoryOptions): Parameters<typeof createSlashMenuUI>[1] {
  return { history } as unknown as Parameters<typeof createSlashMenuUI>[1];
}

function createMemoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: vi.fn((_key: string) => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
    get value() {
      return value;
    },
  };
}

function lastStoredIds(storage: ReturnType<typeof createMemoryStorage>): string[] {
  const calls = storage.setItem.mock.calls;
  const lastCall = calls[calls.length - 1];
  return JSON.parse(lastCall?.[1] ?? "[]") as string[];
}

type SlashReorderOptions =
  | boolean
  | {
      storage?: SlashHistoryStorage;
      storageKey?: string;
    };

function withReorder(
  reorderable: SlashReorderOptions
): Parameters<typeof createSlashMenuUI>[1] {
  return { reorderable } as unknown as Parameters<typeof createSlashMenuUI>[1];
}

const ROW_HEIGHT = 40;

/**
 * JSDOM reports zero-sized rects for every element, so drop-target resolution
 * needs explicit geometry. Rows are laid out top-to-bottom in their live DOM
 * order, which is what the menu reads while a drag is in flight.
 */
function stubRowRects(menu: SlashMenuUI, rowHeight = ROW_HEIGHT): void {
  for (const row of items(menu)) {
    row.getBoundingClientRect = () => {
      const live = Array.from(
        menu.element.querySelectorAll<HTMLElement>(`.${PREFIX}-menu__item`)
      );
      return {
        top: live.indexOf(row) * rowHeight,
        height: rowHeight,
      } as DOMRect;
    };
  }
}

/** A y-coordinate that resolves to rendered position `index` during a drop. */
function dropY(index: number, rowHeight = ROW_HEIGHT): number {
  return index * rowHeight + rowHeight / 2 - 1;
}

function handleOf(menu: SlashMenuUI, id: string): HTMLElement {
  const handle = itemById(menu, id).querySelector<HTMLElement>(
    `.${PREFIX}-menu__handle`
  );
  if (!handle) throw new Error(`Missing drag handle for: ${id}`);
  return handle;
}

function pressHandle(menu: SlashMenuUI, id: string, clientY: number): void {
  handleOf(menu, id).dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientY })
  );
}

function movePointer(clientY: number): void {
  document.dispatchEvent(
    new MouseEvent("mousemove", { bubbles: true, cancelable: true, clientY })
  );
}

function releasePointer(clientY: number): void {
  document.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, cancelable: true, clientY })
  );
}

/** Drags the row for `id` so it lands on rendered position `toIndex`. */
function dragRowTo(menu: SlashMenuUI, id: string, toIndex: number): void {
  const fromIndex = itemIds(menu).indexOf(id);
  stubRowRects(menu);
  pressHandle(menu, id, dropY(fromIndex));
  movePointer(dropY(toIndex));
  releasePointer(dropY(toIndex));
}

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

describe("createSlashMenuUI recent command ordering", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("keeps empty query order in registration order when history is disabled", () => {
    h = setup(baseCommands);
    open(h.editor, "");
    expect(itemIds(h.menu)).toEqual(["h1", "h2", "bold"]);
  });

  it("moves a recently used command to the front for the current session when enabled without storage", () => {
    h = setup(baseCommands, withHistory(true));

    open(h.editor, "");
    items(h.menu)[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    open(h.editor, "");

    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("reads host-injected storage and reorders the empty query menu", () => {
    const storage = createMemoryStorage(JSON.stringify(["bold", "h1"]));
    h = setup(
      baseCommands,
      withHistory({ storage, storageKey: "test-slash-history" })
    );

    open(h.editor, "");

    expect(storage.getItem).toHaveBeenCalledWith("test-slash-history");
    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("writes confirmed commands to storage with dedupe-to-front and maxEntries", () => {
    const storage = createMemoryStorage(JSON.stringify(["h2", "bold", "h1"]));
    h = setup(
      baseCommands,
      withHistory({
        storage,
        storageKey: "test-slash-history",
        maxEntries: 2,
      })
    );

    open(h.editor, "");
    itemById(h.menu, "bold").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    expect(storage.setItem).toHaveBeenCalled();
    expect(lastStoredIds(storage)).toEqual(["bold", "h2"]);
  });

  it("ignores unknown stored command ids", () => {
    const storage = createMemoryStorage(JSON.stringify(["missing", "bold"]));
    h = setup(
      baseCommands,
      withHistory({ storage, storageKey: "test-slash-history" })
    );

    open(h.editor, "");

    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
    expect(items(h.menu).some((item) => item.dataset.slashCommandId === "missing")).toBe(false);
  });

  it("ignores invalid JSON and later writes valid command history", () => {
    const storage = createMemoryStorage("{not-json");
    h = setup(
      baseCommands,
      withHistory({ storage, storageKey: "test-slash-history" })
    );

    expect(() => open(h.editor, "")).not.toThrow();
    items(h.menu)[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(storage.setItem).toHaveBeenCalled();
    expect(lastStoredIds(storage)).toEqual(["bold"]);
  });

  it("does not crash when storage getItem throws", () => {
    const storage: SlashHistoryStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      setItem: vi.fn(),
    };
    h = setup(
      baseCommands,
      withHistory({ storage, storageKey: "test-slash-history" })
    );

    expect(() => open(h.editor, "")).not.toThrow();
    expect(storage.getItem).toHaveBeenCalledWith("test-slash-history");
    expect(itemIds(h.menu)).toEqual(["h1", "h2", "bold"]);
  });

  it("does not crash when storage setItem throws", () => {
    const run = vi.fn();
    const storage: SlashHistoryStorage = {
      getItem: vi.fn(() => JSON.stringify([])),
      setItem: vi.fn(() => {
        throw new Error("storage full");
      }),
    };
    h = setup([{ id: "bold", title: "Bold", run }], withHistory({
      storage,
      storageKey: "test-slash-history",
    }));

    open(h.editor, "");

    expect(() => pressKey("Enter")).not.toThrow();
    expect(storage.setItem).toHaveBeenCalledWith("test-slash-history", JSON.stringify(["bold"]));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("moves ArrowUp and ArrowDown highlight through the reordered list", () => {
    const storage = createMemoryStorage(JSON.stringify(["bold"]));
    h = setup(
      baseCommands,
      withHistory({ storage, storageKey: "test-slash-history" })
    );

    open(h.editor, "");

    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("bold");
    pressKey("ArrowDown");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("h1");
    pressKey("ArrowUp");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("bold");
  });

  it("confirms the reordered active item with Enter", () => {
    const h1Run = vi.fn();
    const boldRun = vi.fn();
    const storage = createMemoryStorage(JSON.stringify(["bold"]));
    h = setup(
      [
        { id: "h1", title: "Heading 1", run: h1Run },
        { id: "h2", title: "Heading 2" },
        { id: "bold", title: "Bold", run: boldRun },
      ],
      withHistory({ storage, storageKey: "test-slash-history" })
    );

    open(h.editor, "");
    pressKey("Enter");

    expect(boldRun).toHaveBeenCalledTimes(1);
    expect(h1Run).not.toHaveBeenCalled();
  });

  it("confirms the clicked reordered item", () => {
    const h1Run = vi.fn();
    const h2Run = vi.fn();
    const boldRun = vi.fn();
    const storage = createMemoryStorage(JSON.stringify(["bold"]));
    h = setup(
      [
        { id: "h1", title: "Heading 1", run: h1Run },
        { id: "h2", title: "Heading 2", run: h2Run },
        { id: "bold", title: "Bold", run: boldRun },
      ],
      withHistory({ storage, storageKey: "test-slash-history" })
    );

    open(h.editor, "");
    items(h.menu)[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(h1Run).toHaveBeenCalledTimes(1);
    expect(h2Run).not.toHaveBeenCalled();
    expect(boldRun).not.toHaveBeenCalled();
  });

  it("keeps keyboard and click behavior unchanged when history is disabled", () => {
    const h1Run = vi.fn();
    const h2Run = vi.fn();
    const boldRun = vi.fn();
    h = setup(
      [
        { id: "h1", title: "Heading 1", run: h1Run },
        { id: "h2", title: "Heading 2", run: h2Run },
        { id: "bold", title: "Bold", run: boldRun },
      ],
      withHistory(false)
    );

    open(h.editor, "");
    pressKey("ArrowDown");
    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("h2");
    pressKey("Enter");
    expect(h2Run).toHaveBeenCalledTimes(1);

    open(h.editor, "");
    items(h.menu)[2].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(boldRun).toHaveBeenCalledTimes(1);
    expect(h1Run).not.toHaveBeenCalled();
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

describe("createSlashMenuUI drag reordering", () => {
  let h: Harness;
  afterEach(() => h?.destroy());

  it("renders no drag handles by default", () => {
    h = setup(baseCommands);
    open(h.editor, "");

    expect(
      h.menu.element.querySelectorAll(`.${PREFIX}-menu__handle`)
    ).toHaveLength(0);
  });

  it("renders a drag handle on every row when enabled", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");

    expect(
      h.menu.element.querySelectorAll(`.${PREFIX}-menu__handle`)
    ).toHaveLength(baseCommands.length);
    for (const command of baseCommands) {
      expect(handleOf(h.menu, command.id)).toBeTruthy();
    }
  });

  it("does not mark rows or handles as HTML5-draggable", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");

    for (const command of baseCommands) {
      expect(itemById(h.menu, command.id).getAttribute("draggable")).toBeNull();
      expect(handleOf(h.menu, command.id).getAttribute("draggable")).toBeNull();
    }
  });

  it("moves a row up to the first position", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");

    dragRowTo(h.menu, "bold", 0);

    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("moves a row down to the last position", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");

    dragRowTo(h.menu, "h1", 2);

    expect(itemIds(h.menu)).toEqual(["h2", "bold", "h1"]);
  });

  it("clamps a drag above the first row", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "bold", dropY(2));
    movePointer(-5000);
    releasePointer(-5000);

    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("clamps a drag below the last row", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "h1", dropY(0));
    movePointer(5000);
    releasePointer(5000);

    expect(itemIds(h.menu)).toEqual(["h2", "bold", "h1"]);
  });

  it("keeps the row count stable across a drag", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");

    dragRowTo(h.menu, "h2", 0);

    expect(items(h.menu)).toHaveLength(baseCommands.length);
    expect(new Set(itemIds(h.menu)).size).toBe(baseCommands.length);
  });

  it("does not start a drag when only one row is rendered", () => {
    h = setup([{ id: "h1", title: "Heading 1" }], withReorder(true));
    open(h.editor, "");

    dragRowTo(h.menu, "h1", 0);

    expect(itemIds(h.menu)).toEqual(["h1"]);
  });

  it("highlights the dropped row", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");

    dragRowTo(h.menu, "bold", 0);

    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("bold");
  });

  it("marks the dragged row only while the gesture is in flight", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "bold", dropY(2));
    expect(h.menu.element.querySelectorAll(".is-dragging")).toHaveLength(0);

    movePointer(dropY(0));
    expect(itemById(h.menu, "bold").classList.contains("is-dragging")).toBe(true);
    expect(h.menu.element.querySelectorAll(".is-dragging")).toHaveLength(1);

    releasePointer(dropY(0));
    expect(h.menu.element.querySelectorAll(".is-dragging")).toHaveLength(0);
  });

  it("inverts the rows that changed slot so they can slide", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "bold", dropY(2));
    movePointer(dropY(0));

    // Moved rows are offset back to their old position first; the transition
    // that releases them is applied on the next frame.
    expect(itemById(h.menu, "h1").style.transform).toContain("translateY");
    expect(itemById(h.menu, "h2").style.transform).toContain("translateY");
    // The held row follows the pointer rather than sliding into a slot.
    expect(itemById(h.menu, "bold").style.transition).toBe("");

    releasePointer(dropY(0));
  });

  it("clears every inline animation style when the gesture ends", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "bold", dropY(2));
    movePointer(dropY(0));
    releasePointer(dropY(0));

    for (const command of baseCommands) {
      const el = itemById(h.menu, command.id);
      expect(el.style.transform).toBe("");
      expect(el.style.transition).toBe("");
    }
  });

  it("skips the slide when the user prefers reduced motion", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      h = setup(baseCommands, withReorder(true));
      open(h.editor, "");
      stubRowRects(h.menu);

      pressHandle(h.menu, "bold", dropY(2));
      movePointer(dropY(0));

      expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
      expect(itemById(h.menu, "h1").style.transform).toBe("");
      expect(itemById(h.menu, "h1").style.transition).toBe("");

      releasePointer(dropY(0));
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("confirms the dropped command with Enter", () => {
    const h1Run = vi.fn();
    const h2Run = vi.fn();
    const boldRun = vi.fn();
    h = setup(
      [
        { id: "h1", title: "Heading 1", run: h1Run },
        { id: "h2", title: "Heading 2", run: h2Run },
        { id: "bold", title: "Bold", run: boldRun },
      ],
      withReorder(true)
    );
    open(h.editor, "");

    dragRowTo(h.menu, "bold", 0);
    pressKey("Enter");

    expect(boldRun).toHaveBeenCalledTimes(1);
    expect(h1Run).not.toHaveBeenCalled();
  });

  it("does not reorder or confirm when a handle is pressed without movement", () => {
    const run = vi.fn();
    h = setup(
      [
        { id: "h1", title: "Heading 1", run },
        { id: "h2", title: "Heading 2" },
        { id: "bold", title: "Bold" },
      ],
      withReorder(true)
    );
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "h2", dropY(1));
    releasePointer(dropY(1));

    expect(itemIds(h.menu)).toEqual(["h1", "h2", "bold"]);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not confirm when a handle is clicked", () => {
    const run = vi.fn();
    h = setup(
      [
        { id: "h1", title: "Heading 1", run },
        { id: "h2", title: "Heading 2" },
      ],
      withReorder(true)
    );
    open(h.editor, "");

    handleOf(h.menu, "h1").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    expect(run).not.toHaveBeenCalled();
    expect(h.menu.element.style.display).not.toBe("none");
  });

  it("restores the pre-drag order when Escape cancels the drag", () => {
    const storage = createMemoryStorage(null);
    h = setup(baseCommands, withReorder({ storage, storageKey: "test-slash-order" }));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "bold", dropY(2));
    movePointer(dropY(0));
    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);

    pressKey("Escape");

    expect(storage.setItem).not.toHaveBeenCalled();
    open(h.editor, "");
    expect(itemIds(h.menu)).toEqual(["h1", "h2", "bold"]);
  });

  it("commits a drop released outside the menu", () => {
    const storage = createMemoryStorage(null);
    h = setup(baseCommands, withReorder({ storage, storageKey: "test-slash-order" }));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "bold", dropY(2));
    movePointer(dropY(0));
    releasePointer(dropY(0));

    expect(lastStoredIds(storage)).toEqual(["bold", "h1", "h2"]);
  });

  it("ignores navigation keys while a drag is in flight", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "bold", dropY(2));
    movePointer(dropY(0));
    pressKey("ArrowDown");

    expect(activeItem(h.menu)?.dataset.slashCommandId).toBe("bold");
    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
    releasePointer(dropY(0));
  });

  it("applies the stored order to an empty query menu", () => {
    const storage = createMemoryStorage(JSON.stringify(["bold", "h1"]));
    h = setup(baseCommands, withReorder({ storage, storageKey: "test-slash-order" }));
    open(h.editor, "");

    expect(storage.getItem).toHaveBeenCalledWith("test-slash-order");
    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("ignores the stored order while a query filters the menu", () => {
    const storage = createMemoryStorage(JSON.stringify(["bold", "h1", "h2"]));
    h = setup(baseCommands, withReorder({ storage }));
    open(h.editor, "h");

    expect(itemIds(h.menu)).toEqual(["h1", "h2"]);
  });

  it("does not start a drag while a query filters the menu", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "h");
    stubRowRects(h.menu);

    pressHandle(h.menu, "h2", dropY(1));
    movePointer(dropY(0));
    releasePointer(dropY(0));

    expect(itemIds(h.menu)).toEqual(["h1", "h2"]);
  });

  it("ignores unknown stored command ids", () => {
    const storage = createMemoryStorage(JSON.stringify(["missing", "bold"]));
    h = setup(baseCommands, withReorder({ storage }));
    open(h.editor, "");

    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("collapses duplicate stored command ids", () => {
    const storage = createMemoryStorage(JSON.stringify(["bold", "bold", "h1"]));
    h = setup(baseCommands, withReorder({ storage }));
    open(h.editor, "");

    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("writes the order once per drop, not during pointer movement", () => {
    const storage = createMemoryStorage(null);
    h = setup(baseCommands, withReorder({ storage, storageKey: "test-slash-order" }));
    open(h.editor, "");
    stubRowRects(h.menu);

    pressHandle(h.menu, "bold", dropY(2));
    movePointer(dropY(1));
    movePointer(dropY(0));
    expect(storage.setItem).not.toHaveBeenCalled();

    releasePointer(dropY(0));

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(lastStoredIds(storage)).toEqual(["bold", "h1", "h2"]);
  });

  it("preserves stored ids for commands outside the visible window", () => {
    const storage = createMemoryStorage(JSON.stringify(["bold", "h1", "h2"]));
    h = setup(
      baseCommands,
      withReorder({ storage, storageKey: "test-slash-order" }),
      { slashMenuLimit: 2 }
    );
    open(h.editor, "");

    // The editor caps results before the menu renders, so a pinned command
    // that did not make the cut stays invisible and cannot be promoted.
    expect(itemIds(h.menu)).toEqual(["h1", "h2"]);

    dragRowTo(h.menu, "h2", 0);

    expect(itemIds(h.menu)).toEqual(["h2", "h1"]);
    // `bold` is dropped out of the visible window but must survive the write.
    expect(lastStoredIds(storage)).toEqual(["h2", "h1", "bold"]);
  });

  it("keeps a session-only order when no storage is injected", () => {
    h = setup(baseCommands, withReorder(true));
    open(h.editor, "");

    dragRowTo(h.menu, "bold", 0);

    open(h.editor, "");
    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("places manually ordered commands ahead of recently used ones", () => {
    const storage = createMemoryStorage(JSON.stringify(["h2"]));
    h = setup(baseCommands, {
      history: true,
      reorderable: { storage },
    } as unknown as Parameters<typeof createSlashMenuUI>[1]);
    open(h.editor, "");

    itemById(h.menu, "bold").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    open(h.editor, "");

    // `bold` is the most recent command, but `h2` was placed by hand.
    expect(itemIds(h.menu)).toEqual(["h2", "bold", "h1"]);
  });

  it("keeps the recency order for commands the user never placed", () => {
    const storage = createMemoryStorage(JSON.stringify(["h2"]));
    h = setup(baseCommands, {
      history: true,
      reorderable: { storage },
    } as unknown as Parameters<typeof createSlashMenuUI>[1]);
    open(h.editor, "");

    itemById(h.menu, "bold").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
    open(h.editor, "");
    itemById(h.menu, "h1").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    open(h.editor, "");

    // Recency produced [h1, bold, h2]; only `h2` is manually pinned.
    expect(itemIds(h.menu)).toEqual(["h2", "h1", "bold"]);
  });

  it("tolerates invalid JSON in order storage", () => {
    const storage = createMemoryStorage("{not json");
    h = setup(baseCommands, withReorder({ storage }));
    open(h.editor, "");

    expect(itemIds(h.menu)).toEqual(["h1", "h2", "bold"]);
  });

  it("tolerates a throwing getItem in order storage", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(),
    };
    h = setup(baseCommands, withReorder({ storage }));

    expect(() => open(h.editor, "")).not.toThrow();
    expect(itemIds(h.menu)).toEqual(["h1", "h2", "bold"]);
  });

  it("tolerates a throwing setItem in order storage", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("quota");
      }),
    };
    h = setup(baseCommands, withReorder({ storage }));
    open(h.editor, "");

    expect(() => dragRowTo(h.menu, "bold", 0)).not.toThrow();
    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
  });

  it("leaves history ordering untouched when reordering is disabled", () => {
    h = setup(baseCommands, withHistory(true));
    open(h.editor, "");

    itemById(h.menu, "bold").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
    open(h.editor, "");

    expect(itemIds(h.menu)).toEqual(["bold", "h1", "h2"]);
    expect(
      h.menu.element.querySelectorAll(`.${PREFIX}-menu__handle`)
    ).toHaveLength(0);
  });
});
