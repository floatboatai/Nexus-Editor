import type { EditorAPI } from "@floatboat/nexus-core";
import {
  findFuzzyNextIndex,
  findFuzzyPreviousIndex,
  findFuzzyReplaceIndex,
  findSearchMatches,
  replaceAllMatches
} from "@floatboat/nexus-plugin-search";

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
  findInput.style.cssText = INPUT_STYLES;

  // Replace input
  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.placeholder = "Replace...";
  replaceInput.style.cssText = INPUT_STYLES;
  replaceInput.style.width = "160px";

  // Buttons
  const prevBtn = document.createElement("button");
  prevBtn.textContent = "\u2191"; // ↑
  prevBtn.title = "Previous match";
  prevBtn.style.cssText = BTN_STYLES;

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "\u2193"; // ↓
  nextBtn.title = "Next match";
  nextBtn.style.cssText = BTN_STYLES;

  const replaceBtn = document.createElement("button");
  replaceBtn.textContent = "Replace";
  replaceBtn.style.cssText = BTN_STYLES;

  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.textContent = "All";
  replaceAllBtn.title = "Replace all";
  replaceAllBtn.style.cssText = BTN_STYLES;

  const fuzzyToggle = document.createElement("label");
  fuzzyToggle.style.cssText = "display:flex;align-items:center;gap:4px;font-size:12px;color:var(--nexus-text-muted,#888);cursor:pointer;";
  const fuzzyCheckbox = document.createElement("input");
  fuzzyCheckbox.type = "checkbox";
  fuzzyCheckbox.title = "Fuzzy match";
  const fuzzyLabel = document.createElement("span");
  fuzzyLabel.textContent = "Fuzzy";
  fuzzyToggle.append(fuzzyCheckbox, fuzzyLabel);

  // Count label
  const countLabel = document.createElement("span");
  countLabel.style.cssText = COUNT_STYLES;

  // Close
  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close (Esc)";
  closeBtn.style.cssText = CLOSE_BTN_STYLES;

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  bar.append(findInput, fuzzyToggle, prevBtn, nextBtn, countLabel, replaceInput, replaceBtn, replaceAllBtn, spacer, closeBtn);

  // State
  let matches: Array<{ from: number; to: number }> = [];
  let currentIdx = -1;
  let visible = false;

  function syncCurrentIndexFromSelection() {
    if (matches.length === 0) {
      currentIdx = -1;
      return;
    }

    const { anchor, head } = editor.getSelection();
    const selectionFrom = Math.min(anchor, head);
    const selectionTo = Math.max(anchor, head);
    const cursor = head;

    if (fuzzyCheckbox.checked) {
      currentIdx = findFuzzyReplaceIndex(matches, selectionFrom, selectionTo, cursor);
      return;
    }

    currentIdx = 0;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].from >= anchor) {
        currentIdx = i;
        break;
      }
    }
  }

  function updateMatches() {
    const query = findInput.value;
    if (!query) {
      matches = [];
      currentIdx = -1;
      countLabel.textContent = "";
      return;
    }
    const doc = editor.getDocument();
    matches = findSearchMatches(doc, query, { fuzzy: fuzzyCheckbox.checked });
    if (matches.length === 0) {
      currentIdx = -1;
      countLabel.textContent = "0 results";
    } else {
      syncCurrentIndexFromSelection();
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
    if (fuzzyCheckbox.checked) {
      const { anchor, head } = editor.getSelection();
      const selectionFrom = Math.min(anchor, head);
      const selectionTo = Math.max(anchor, head);
      currentIdx = findFuzzyNextIndex(matches, selectionFrom, selectionTo, head);
    } else {
      currentIdx = (currentIdx + 1) % matches.length;
    }
    highlightCurrent();
  }

  function goPrev() {
    if (matches.length === 0) return;
    if (fuzzyCheckbox.checked) {
      const { anchor, head } = editor.getSelection();
      const selectionFrom = Math.min(anchor, head);
      const selectionTo = Math.max(anchor, head);
      currentIdx = findFuzzyPreviousIndex(matches, selectionFrom, selectionTo, head);
    } else {
      currentIdx = (currentIdx - 1 + matches.length) % matches.length;
    }
    highlightCurrent();
  }

  function doReplace() {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    const m = matches[currentIdx];
    const doc = editor.getDocument();
    const replacement = replaceInput.value;
    const newDoc = doc.slice(0, m.from) + replacement + doc.slice(m.to);
    editor.setDocument(newDoc);
    editor.setSelection(m.from + replacement.length);
    updateMatches();
    if (fuzzyCheckbox.checked && matches.length > 0) {
      const { anchor, head } = editor.getSelection();
      const selectionFrom = Math.min(anchor, head);
      const selectionTo = Math.max(anchor, head);
      currentIdx = findFuzzyNextIndex(matches, selectionFrom, selectionTo, head);
      highlightCurrent();
    }
  }

  function doReplaceAll() {
    const query = findInput.value;
    if (!query) return;
    const doc = editor.getDocument();
    const newDoc = replaceAllMatches(doc, query, replaceInput.value, { fuzzy: fuzzyCheckbox.checked });
    editor.setDocument(newDoc);
    updateMatches();
  }

  // Event handlers
  findInput.addEventListener("input", updateMatches);
  fuzzyCheckbox.addEventListener("change", updateMatches);
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
