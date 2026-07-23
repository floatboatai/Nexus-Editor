import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditorShell, type EditorShell } from "../src/renderer/editor-shell";
import { createSearchBar, type SearchBar } from "../src/renderer/search-bar";
import { createState } from "../src/renderer/state";
import { defaultSettings } from "../src/renderer/settings";

function setup(doc: string) {
  const container = document.createElement("div");
  document.body.append(container);
  const shell = createEditorShell({
    container,
    state: createState(),
    settings: defaultSettings(),
    onStateChange: vi.fn(),
  });
  shell.loadDocument(doc);
  const bar = createSearchBar(shell.editor);
  document.body.append(bar.element);
  return { shell, bar };
}

function findInput(bar: SearchBar): HTMLInputElement {
  return bar.element.querySelector<HTMLInputElement>('input[placeholder="Find..."]')!;
}

function fuzzyButton(bar: SearchBar): HTMLButtonElement {
  return bar.element.querySelector<HTMLButtonElement>(".nexus-search-fuzzy")!;
}

function countLabel(bar: SearchBar): HTMLSpanElement {
  return bar.element.querySelector<HTMLSpanElement>(".nexus-search-count")!;
}

function previewRow(bar: SearchBar): HTMLDivElement {
  return bar.element.querySelector<HTMLDivElement>(".nexus-search-preview")!;
}

function typeQuery(bar: SearchBar, query: string): void {
  const input = findInput(bar);
  input.value = query;
  input.dispatchEvent(new Event("input"));
}

describe("search-bar — visibility", () => {
  let shell: EditorShell;
  let bar: SearchBar;

  beforeEach(() => {
    ({ shell, bar } = setup("hello world"));
  });

  afterEach(() => {
    bar.destroy();
    shell.destroy();
    document.body.textContent = "";
  });

  it("starts hidden and opens on demand", () => {
    expect(bar.isOpen()).toBe(false);
    bar.open();
    expect(bar.isOpen()).toBe(true);
    expect(bar.element.style.display).toBe("flex");
  });

  it("closes and clears state", () => {
    bar.open();
    bar.close();
    expect(bar.isOpen()).toBe(false);
    expect(bar.element.style.display).toBe("none");
    expect(countLabel(bar).textContent).toBe("");
  });
});

describe("search-bar — literal search", () => {
  let shell: EditorShell;
  let bar: SearchBar;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ shell, bar } = setup("hello world hello"));
    bar.open();
  });

  afterEach(() => {
    vi.useRealTimers();
    bar.destroy();
    shell.destroy();
    document.body.textContent = "";
  });

  it("finds literal matches after the debounce window", () => {
    typeQuery(bar, "hello");
    vi.advanceTimersByTime(100);
    expect(countLabel(bar).textContent).toBe("1 / 2");
    // The current match is selected in the editor.
    expect(shell.editor.getSelection()).toEqual({ anchor: 0, head: 5 });
  });

  it("does not match subsequence queries in literal mode", () => {
    typeQuery(bar, "hlo");
    vi.advanceTimersByTime(100);
    expect(countLabel(bar).textContent).toBe("0 results");
  });
});

describe("search-bar — fuzzy search", () => {
  let shell: EditorShell;
  let bar: SearchBar;

  beforeEach(() => {
    vi.useFakeTimers();
    ({ shell, bar } = setup("hello world"));
    bar.open({ fuzzy: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    bar.destroy();
    shell.destroy();
    document.body.textContent = "";
  });

  it("matches subsequences that literal search cannot", () => {
    typeQuery(bar, "hlo");
    vi.advanceTimersByTime(100);
    expect(countLabel(bar).textContent).toBe("1 / 1");
    // Fuzzy window spans from the first to the last matched character.
    expect(shell.editor.getSelection()).toEqual({ anchor: 0, head: 5 });
  });

  it("renders the preview row with one mark per matched character", () => {
    typeQuery(bar, "hlo");
    vi.advanceTimersByTime(100);
    const preview = previewRow(bar);
    expect(preview.style.display).toBe("block");
    const marks = Array.from(preview.querySelectorAll("mark"));
    expect(marks.map((m) => m.textContent)).toEqual(["h", "l", "o"]);
    expect(preview.textContent).toContain("score");
  });

  it("hides the preview for non-fuzzy mode", () => {
    typeQuery(bar, "hello");
    vi.advanceTimersByTime(100);
    expect(previewRow(bar).style.display).toBe("block");
    fuzzyButton(bar).click(); // switch back to literal
    expect(previewRow(bar).style.display).toBe("none");
    expect(countLabel(bar).textContent).toBe("1 / 1");
  });

  it("replaces all fuzzy matches", () => {
    bar.close();
    shell.loadDocument("foo bar foo");
    bar.open({ fuzzy: true });
    typeQuery(bar, "fo");
    vi.advanceTimersByTime(100);
    const replaceInput = bar.element.querySelector<HTMLInputElement>('input[placeholder="Replace..."]')!;
    replaceInput.value = "X";
    const allBtn = Array.from(bar.element.querySelectorAll("button")).find(
      (b) => b.textContent === "All"
    )!;
    allBtn.click();
    expect(shell.editor.getDocument()).toBe("Xo bar Xo");
  });
});
