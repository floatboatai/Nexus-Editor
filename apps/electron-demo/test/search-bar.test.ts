import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorAPI } from "@floatboat/nexus-core";
import { createSearchBar } from "../src/renderer/search-bar";

function createMockEditor(initialDoc: string): EditorAPI {
  let doc = initialDoc;
  let selection = { anchor: 0, head: 0 };

  return {
    getDocument: () => doc,
    getAst: vi.fn(),
    setDocument: vi.fn((nextDoc: string) => {
      doc = nextDoc;
    }),
    getSelection: () => selection,
    setSelection: vi.fn((anchor: number, head = anchor) => {
      selection = { anchor, head };
    }),
    focus: vi.fn(),
    blur: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(() => () => undefined)
  } as unknown as EditorAPI;
}

describe("createSearchBar", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("keeps fuzzy search opt-in and updates matches when enabled", () => {
    const editor = createMockEditor("Nexus Editor");
    const searchBar = createSearchBar(editor);
    document.body.append(searchBar.element);
    searchBar.open();

    const input = searchBar.element.querySelector<HTMLInputElement>("[data-test-id='search-find-input']");
    const fuzzyToggle = searchBar.element.querySelector<HTMLInputElement>("[data-test-id='search-fuzzy-toggle']");
    expect(input).not.toBeNull();
    expect(fuzzyToggle).not.toBeNull();
    expect(input?.getAttribute("aria-label")).toBe("Find");
    expect(fuzzyToggle?.checked).toBe(false);
    expect(fuzzyToggle?.getAttribute("aria-label")).toBe("Fuzzy search");

    input!.value = "nr";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.setSelection).not.toHaveBeenCalled();

    fuzzyToggle!.checked = true;
    fuzzyToggle!.dispatchEvent(new Event("change", { bubbles: true }));
    expect(editor.setSelection).toHaveBeenLastCalledWith(0, 12);

    searchBar.destroy();
    searchBar.element.remove();
  });

  it("uses fuzzy replacement when the fuzzy toggle is enabled", () => {
    const editor = createMockEditor("Nexus Editor");
    const searchBar = createSearchBar(editor);
    document.body.append(searchBar.element);
    searchBar.open();

    const findInput = searchBar.element.querySelector<HTMLInputElement>("[data-test-id='search-find-input']");
    const replaceInput = searchBar.element.querySelector<HTMLInputElement>("[data-test-id='search-replace-input']");
    const fuzzyToggle = searchBar.element.querySelector<HTMLInputElement>("[data-test-id='search-fuzzy-toggle']");
    const replaceButton = searchBar.element.querySelector<HTMLButtonElement>(
      "[data-test-id='search-replace-button']"
    );
    const replaceAllButton = searchBar.element.querySelector<HTMLButtonElement>(
      "[data-test-id='search-replace-all-button']"
    );

    expect(findInput).not.toBeNull();
    expect(replaceInput).not.toBeNull();
    expect(fuzzyToggle).not.toBeNull();
    expect(replaceButton).not.toBeNull();
    expect(replaceAllButton).not.toBeNull();
    expect(replaceInput?.getAttribute("aria-label")).toBe("Replace");
    expect(replaceButton?.type).toBe("button");
    expect(replaceAllButton?.getAttribute("aria-label")).toBe("Replace all");
    expect(replaceAllButton?.type).toBe("button");

    findInput!.value = "ne";
    replaceInput!.value = "NE";
    fuzzyToggle!.checked = true;
    replaceAllButton!.click();

    expect(editor.setDocument).toHaveBeenLastCalledWith("NExus Editor");

    searchBar.destroy();
    searchBar.element.remove();
  });
});
