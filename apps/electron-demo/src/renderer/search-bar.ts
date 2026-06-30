import type { EditorAPI } from "@floatboat/nexus-core";
import { findSearchMatches, replaceAllMatches } from "@floatboat/nexus-plugin-search";

export interface SearchBar {
  element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

const BAR_STYLES = `
  display: none;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--nexus-bg-subtle, #f6f8fa);
  border-bottom: 1px solid var(--nexus-border, #eee);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  flex-shrink: 0;
`;

const INPUT_STYLES = `
  padding: 4px 8px;
  border: 1px solid var(--nexus-border, #ddd);
  border-radius: 4px;
  font-size: 13px;
  font-family: inherit;
  background: var(--nexus-bg, #fff);
  color: var(--nexus-text, #24292e);
  outline: none;
  width: 200px;
`;

const BTN_STYLES = `
  padding: 4px 10px;
  border: 1px solid var(--nexus-border, #ddd);
  border-radius: 4px;
  background: var(--nexus-bg, #fff);
  color: var(--nexus-text, #24292e);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  transition: background 0.1s;
`;

const COUNT_STYLES = `
  color: var(--nexus-text-muted, #888);
  font-size: 12px;
  min-width: 60px;
`;

const TOGGLE_STYLES = `
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--nexus-text-muted, #666);
  font-size: 12px;
  user-select: none;
`;

const CLOSE_BTN_STYLES = `
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--nexus-text-muted, #888);
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
`;

export function createSearchBar(editor: EditorAPI): SearchBar {
  const bar = document.createElement("div");
  bar.className = "nexus-search-bar";
  bar.style.cssText = BAR_STYLES;

  // Find input
  const findInput = document.createElement("input");
  findInput.type = "text";
  findInput.placeholder = "Find...";
  findInput.setAttribute("aria-label", "Find");
  findInput.dataset.testId = "search-find-input";
  findInput.style.cssText = INPUT_STYLES;

  // Replace input
  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.placeholder = "Replace...";
  replaceInput.setAttribute("aria-label", "Replace");
  replaceInput.dataset.testId = "search-replace-input";
  replaceInput.style.cssText = INPUT_STYLES;
  replaceInput.style.width = "160px";

  // Buttons
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.textContent = "\u2191"; // ↑
  prevBtn.title = "Previous match";
  prevBtn.setAttribute("aria-label", "Previous match");
  prevBtn.dataset.testId = "search-previous-button";
  prevBtn.style.cssText = BTN_STYLES;

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.textContent = "\u2193"; // ↓
  nextBtn.title = "Next match";
  nextBtn.setAttribute("aria-label", "Next match");
  nextBtn.dataset.testId = "search-next-button";
  nextBtn.style.cssText = BTN_STYLES;

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.textContent = "Replace";
  replaceBtn.title = "Replace";
  replaceBtn.setAttribute("aria-label", "Replace");
  replaceBtn.dataset.testId = "search-replace-button";
  replaceBtn.style.cssText = BTN_STYLES;

  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.type = "button";
  replaceAllBtn.textContent = "All";
  replaceAllBtn.title = "Replace all";
  replaceAllBtn.setAttribute("aria-label", "Replace all");
  replaceAllBtn.dataset.testId = "search-replace-all-button";
  replaceAllBtn.style.cssText = BTN_STYLES;

  const fuzzyToggle = document.createElement("input");
  fuzzyToggle.type = "checkbox";
  fuzzyToggle.title = "Use fuzzy subsequence matching";
  fuzzyToggle.setAttribute("aria-label", "Fuzzy search");
  fuzzyToggle.dataset.testId = "search-fuzzy-toggle";

  const fuzzyLabel = document.createElement("label");
  fuzzyLabel.style.cssText = TOGGLE_STYLES;
  fuzzyLabel.append(fuzzyToggle, "Fuzzy");

  // Count label
  const countLabel = document.createElement("span");
  countLabel.style.cssText = COUNT_STYLES;

  // Close
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close (Esc)";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.dataset.testId = "search-close-button";
  closeBtn.style.cssText = CLOSE_BTN_STYLES;

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  bar.append(
    findInput,
    fuzzyLabel,
    prevBtn,
    nextBtn,
    countLabel,
    replaceInput,
    replaceBtn,
    replaceAllBtn,
    spacer,
    closeBtn
  );

  // State
  let matches: Array<{ from: number; to: number }> = [];
  let currentIdx = -1;
  let visible = false;

  function updateMatches() {
    const query = findInput.value;
    if (!query) {
      matches = [];
      currentIdx = -1;
      countLabel.textContent = "";
      return;
    }
    const doc = editor.getDocument();
    matches = findSearchMatches(doc, query, { fuzzy: fuzzyToggle.checked });
    if (matches.length === 0) {
      currentIdx = -1;
      countLabel.textContent = "0 results";
    } else {
      // Find nearest match to current cursor
      const { anchor } = editor.getSelection();
      currentIdx = 0;
      for (let i = 0; i < matches.length; i++) {
        if (matches[i].from >= anchor) { currentIdx = i; break; }
      }
      highlightCurrent();
    }
  }

  function highlightCurrent() {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    const m = matches[currentIdx];
    editor.setSelection(m.from, m.to);
    editor.focus();
    countLabel.textContent = `${currentIdx + 1} / ${matches.length}`;
  }

  function goNext() {
    if (matches.length === 0) return;
    currentIdx = (currentIdx + 1) % matches.length;
    highlightCurrent();
  }

  function goPrev() {
    if (matches.length === 0) return;
    currentIdx = (currentIdx - 1 + matches.length) % matches.length;
    highlightCurrent();
  }

  function doReplace() {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    const m = matches[currentIdx];
    const doc = editor.getDocument();
    const newDoc = doc.slice(0, m.from) + replaceInput.value + doc.slice(m.to);
    editor.setDocument(newDoc);
    editor.setSelection(m.from + replaceInput.value.length);
    updateMatches();
  }

  function doReplaceAll() {
    const query = findInput.value;
    if (!query) return;
    const doc = editor.getDocument();
    const newDoc = replaceAllMatches(doc, query, replaceInput.value, { fuzzy: fuzzyToggle.checked });
    editor.setDocument(newDoc);
    updateMatches();
  }

  // Event handlers
  findInput.addEventListener("input", updateMatches);
  fuzzyToggle.addEventListener("change", updateMatches);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.shiftKey ? goPrev() : goNext(); e.preventDefault(); }
    if (e.key === "Escape") { close(); }
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { doReplace(); e.preventDefault(); }
    if (e.key === "Escape") { close(); }
  });
  nextBtn.addEventListener("click", goNext);
  prevBtn.addEventListener("click", goPrev);
  replaceBtn.addEventListener("click", doReplace);
  replaceAllBtn.addEventListener("click", doReplaceAll);
  closeBtn.addEventListener("click", close);

  function open() {
    if (visible) { findInput.focus(); findInput.select(); return; }
    visible = true;
    bar.style.display = "flex";
    findInput.focus();
    // Pre-fill with selected text
    const { anchor, head } = editor.getSelection();
    if (anchor !== head) {
      const doc = editor.getDocument();
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      const sel = doc.slice(from, to);
      if (sel.length < 100 && !sel.includes("\n")) {
        findInput.value = sel;
        updateMatches();
      }
    }
    findInput.select();
  }

  function close() {
    visible = false;
    bar.style.display = "none";
    matches = [];
    currentIdx = -1;
    countLabel.textContent = "";
    editor.focus();
  }

  return {
    element: bar,
    open,
    close,
    isOpen: () => visible,
    destroy() {
      close();
      bar.remove();
    },
  };
}
