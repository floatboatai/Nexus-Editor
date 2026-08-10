import type { EditorAPI } from "@floatboat/nexus-core";
import { findFuzzyMatches, findSearchMatches, replaceAllMatches } from "@floatboat/nexus-plugin-search";

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

  const findInput = document.createElement("input");
  findInput.type = "text";
  findInput.placeholder = "Find...";
  findInput.style.cssText = INPUT_STYLES;

  const fuzzyBtn = document.createElement("button");
  fuzzyBtn.type = "button";
  fuzzyBtn.textContent = "Fuzzy";
  fuzzyBtn.title = "Toggle fuzzy subsequence matching";
  fuzzyBtn.setAttribute("aria-pressed", "false");
  fuzzyBtn.style.cssText = BTN_STYLES;

  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.placeholder = "Replace...";
  replaceInput.style.cssText = INPUT_STYLES;
  replaceInput.style.width = "160px";

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "\u2191";
  prevBtn.title = "Previous match";
  prevBtn.style.cssText = BTN_STYLES;

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "\u2193";
  nextBtn.title = "Next match";
  nextBtn.style.cssText = BTN_STYLES;

  const replaceBtn = document.createElement("button");
  replaceBtn.textContent = "Replace";
  replaceBtn.style.cssText = BTN_STYLES;

  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.textContent = "All";
  replaceAllBtn.title = "Replace all";
  replaceAllBtn.style.cssText = BTN_STYLES;

  const countLabel = document.createElement("span");
  countLabel.style.cssText = COUNT_STYLES;

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close (Esc)";
  closeBtn.style.cssText = CLOSE_BTN_STYLES;

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  bar.append(
    findInput,
    fuzzyBtn,
    prevBtn,
    nextBtn,
    countLabel,
    replaceInput,
    replaceBtn,
    replaceAllBtn,
    spacer,
    closeBtn
  );

  let matches: Array<{ from: number; to: number }> = [];
  let currentIdx = -1;
  let visible = false;
  let fuzzyMode = false;

  function updateControls() {
    const replaceDisabled = fuzzyMode;
    replaceInput.disabled = replaceDisabled;
    replaceBtn.disabled = replaceDisabled;
    replaceAllBtn.disabled = replaceDisabled;
    replaceInput.title = replaceDisabled ? "Replacement is disabled for fuzzy matches" : "";
    replaceBtn.title = replaceDisabled ? "Replacement is disabled for fuzzy matches" : "Replace";
    replaceAllBtn.title = replaceDisabled
      ? "Replacement is disabled for fuzzy matches"
      : "Replace all";
    fuzzyBtn.setAttribute("aria-pressed", String(fuzzyMode));
    fuzzyBtn.style.fontWeight = fuzzyMode ? "600" : "400";
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
    matches = fuzzyMode ? findFuzzyMatches(doc, query) : findSearchMatches(doc, query);
    if (matches.length === 0) {
      currentIdx = -1;
      countLabel.textContent = "0 results";
      return;
    }

    const { anchor } = editor.getSelection();
    currentIdx = 0;
    for (let i = 0; i < matches.length; i++) {
      if (matches[i].from >= anchor) {
        currentIdx = i;
        break;
      }
    }
    highlightCurrent();
  }

  function highlightCurrent() {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    const match = matches[currentIdx];
    editor.setSelection(match.from, match.to);
    editor.focus();
    countLabel.textContent = `${currentIdx + 1} / ${matches.length}${fuzzyMode ? " fuzzy" : ""}`;
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
    if (fuzzyMode || currentIdx < 0 || currentIdx >= matches.length) return;
    const match = matches[currentIdx];
    const doc = editor.getDocument();
    const newDoc = doc.slice(0, match.from) + replaceInput.value + doc.slice(match.to);
    editor.setDocument(newDoc);
    editor.setSelection(match.from + replaceInput.value.length);
    updateMatches();
  }

  function doReplaceAll() {
    if (fuzzyMode) return;
    const query = findInput.value;
    if (!query) return;
    const doc = editor.getDocument();
    const newDoc = replaceAllMatches(doc, query, replaceInput.value);
    editor.setDocument(newDoc);
    updateMatches();
  }

  findInput.addEventListener("input", updateMatches);
  findInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.shiftKey ? goPrev() : goNext();
      event.preventDefault();
    }
    if (event.key === "Escape") close();
  });
  replaceInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      doReplace();
      event.preventDefault();
    }
    if (event.key === "Escape") close();
  });
  fuzzyBtn.addEventListener("click", () => {
    fuzzyMode = !fuzzyMode;
    updateControls();
    updateMatches();
  });
  nextBtn.addEventListener("click", goNext);
  prevBtn.addEventListener("click", goPrev);
  replaceBtn.addEventListener("click", doReplace);
  replaceAllBtn.addEventListener("click", doReplaceAll);
  closeBtn.addEventListener("click", close);

  updateControls();

  function open() {
    if (visible) {
      findInput.focus();
      findInput.select();
      return;
    }
    visible = true;
    bar.style.display = "flex";
    findInput.focus();
    const { anchor, head } = editor.getSelection();
    if (anchor !== head) {
      const doc = editor.getDocument();
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      const selection = doc.slice(from, to);
      if (selection.length < 100 && !selection.includes("\n")) {
        findInput.value = selection;
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
    }
  };
}
