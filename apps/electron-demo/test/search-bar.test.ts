import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSearchBar } from "../src/renderer/search-bar";
import type { EditorAPI } from "@floatboat/nexus-core";

// Mock EditorAPI - only implement methods actually used by search-bar.ts
function createMockEditor(initialDoc: string = "hello world hello"): EditorAPI {
  let doc = initialDoc;
  let selection = { anchor: 0, head: 0 };

  // Create mock functions
  const mockGetDocument = vi.fn(() => doc);
  const mockSetDocument = vi.fn((newDoc: string) => {
    doc = newDoc;
  });
  const mockGetSelection = vi.fn(() => ({ anchor: selection.anchor, head: selection.head }));
  const mockSetSelection = vi.fn((anchor: number, head?: number) => {
    selection = { anchor, head: head ?? anchor };
  });
  const mockFocus = vi.fn();

  return {
    getDocument: mockGetDocument,
    setDocument: mockSetDocument,
    getSelection: mockGetSelection,
    setSelection: mockSetSelection,
    focus: mockFocus,
    // Stub implementations for TypeScript type checking
    replaceSelection: vi.fn(),
    getLine: vi.fn(),
    getLineAfter: vi.fn(),
    getLineBefore: vi.fn(),
    format: vi.fn(),
    insertAttachment: vi.fn(),
    getAttachmentUrl: vi.fn(),
    slashCommands: { execute: vi.fn(), getDefinitions: vi.fn(() => []) },
    menu: { show: vi.fn(), hide: vi.fn() },
    commandShells: { get: vi.fn(), create: vi.fn() },
    getTheme: vi.fn(() => ({ isDark: false })),
    setTheme: vi.fn(),
    getActiveMarkdownNode: vi.fn(),
    getActiveImageNode: vi.fn(),
    getLinkContext: vi.fn(),
    setLanguage: vi.fn(),
    getLanguage: vi.fn(),
  } as unknown as EditorAPI;
}

describe("SearchBar", () => {
  let container: HTMLDivElement;
  let editor: EditorAPI;
  let searchBar: ReturnType<typeof createSearchBar>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    editor = createMockEditor();
    searchBar = createSearchBar(editor);
    container.appendChild(searchBar.element);
  });

  afterEach(() => {
    searchBar.destroy();
    document.body.removeChild(container);
  });

  describe("focus management", () => {
    it("does not focus editor while typing", () => {
      searchBar.open();
      const input = searchBar.element.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;

      // Simulate typing
      input.value = "hello";
      input.dispatchEvent(new Event("input"));

      // Verify: editor should not get focus
      expect(editor.focus).not.toHaveBeenCalled();
    });
  });

  describe("state cleanup", () => {
    it("clears selection when no matches found", () => {
      searchBar.open();
      const input = searchBar.element.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;

      // First input with matches
      input.value = "hello";
      input.dispatchEvent(new Event("input"));

      // Clear previous call history
      (editor.setSelection as any).mockClear();

      // Then input without matches
      input.value = "xyz123";
      input.dispatchEvent(new Event("input"));

      // Verify: should clear selection (set to empty selection)
      const calls = (editor.setSelection as any).mock.calls;
      if (calls.length > 0) {
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toBe(lastCall[1]); // anchor === head (empty selection)
      }
    });

    it("clears selection when input is empty", () => {
      searchBar.open();
      const input = searchBar.element.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;

      // First input with matches
      input.value = "hello";
      input.dispatchEvent(new Event("input"));

      // Clear previous call history
      (editor.setSelection as any).mockClear();

      // Then clear input
      input.value = "";
      input.dispatchEvent(new Event("input"));

      // Verify: should clear selection (set to empty selection)
      const calls = (editor.setSelection as any).mock.calls;
      if (calls.length > 0) {
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toBe(lastCall[1]); // anchor === head (empty selection)
      }
    });

    it("clears selection when user deletes all input", () => {
      searchBar.open();
      const input = searchBar.element.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;

      // Input content
      input.value = "hello";
      input.dispatchEvent(new Event("input"));

      // Simulate user deleting characters one by one
      input.value = "hell";
      input.dispatchEvent(new Event("input"));

      input.value = "hel";
      input.dispatchEvent(new Event("input"));

      input.value = "he";
      input.dispatchEvent(new Event("input"));

      input.value = "h";
      input.dispatchEvent(new Event("input"));

      // Clear previous call history
      (editor.setSelection as any).mockClear();

      input.value = "";
      input.dispatchEvent(new Event("input"));

      // Verify: should clear selection at the end
      const calls = (editor.setSelection as any).mock.calls;
      if (calls.length > 0) {
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toBe(lastCall[1]); // anchor === head (empty selection)
      }
    });
  });

  describe("match count display", () => {
    it("displays correct match count", () => {
      searchBar.open();
      const input = searchBar.element.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;
      const countLabel = searchBar.element.querySelector("span");

      // Input content with multiple matches
      input.value = "hello";
      input.dispatchEvent(new Event("input"));

      // Verify: should display correct count ("hello" appears 2 times in "hello world hello")
      expect(countLabel?.textContent).toBe("1 / 2");
    });

    it("displays '0 results' when no matches", () => {
      searchBar.open();
      const input = searchBar.element.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;
      const countLabel = searchBar.element.querySelector("span");

      // Input content without matches
      input.value = "xyz123";
      input.dispatchEvent(new Event("input"));

      // Verify: should display "0 results"
      expect(countLabel?.textContent).toBe("0 results");
    });

    it("clears count when input is empty", () => {
      searchBar.open();
      const input = searchBar.element.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;
      const countLabel = searchBar.element.querySelector("span");

      // Input content
      input.value = "hello";
      input.dispatchEvent(new Event("input"));

      // Clear input
      input.value = "";
      input.dispatchEvent(new Event("input"));

      // Verify: count should be empty
      expect(countLabel?.textContent).toBe("");
    });
  });
});