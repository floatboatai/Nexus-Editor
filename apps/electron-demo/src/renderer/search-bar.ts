import type { EditorAPI } from "@floatboat/nexus-core";
import {
  findFuzzyMatches,
  findSearchMatches,
  replaceAllMatches,
  type FuzzyMatch,
} from "@floatboat/nexus-plugin-search";

export interface SearchBar {
  element: HTMLElement;
  open(opts?: { fuzzy?: boolean }): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

const WRAPPER_STYLES = `
  display: none;
  flex-direction: column;
  flex-shrink: 0;
  border-bottom: 1px solid var(--nexus-border, #eee);
  background: var(--nexus-bg-subtle, #f6f8fa);
`;

const BAR_STYLES = `
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
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

const FUZZY_BTN_ACTIVE_STYLES = `
  background: var(--nexus-accent, #0969da);
  border-color: var(--nexus-accent, #0969da);
  color: #fff;
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

const PREVIEW_STYLES = `
  display: none;
  padding: 4px 12px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--nexus-text, #24292e);
  white-space: pre-wrap;
  word-break: break-all;
  border-top: 1px dashed var(--nexus-border, #eee);
`;

const MARK_STYLES = `
  background: rgba(255, 214, 10, 0.45);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
`;

const SCORE_STYLES = `
  color: var(--nexus-text-muted, #888);
  font-size: 11px;
  margin-left: 8px;
  white-space: nowrap;
`;

/** Characters of context shown around the fuzzy match window. */
const PREVIEW_CONTEXT_CHARS = 16;
/** Input events are coalesced so large documents don't re-search per keystroke. */
const SEARCH_DEBOUNCE_MS = 80;

export function createSearchBar(editor: EditorAPI): SearchBar {
  const wrapper = document.createElement("div");
  wrapper.className = "nexus-search-wrapper";
  wrapper.style.cssText = WRAPPER_STYLES;

  const bar = document.createElement("div");
  bar.className = "nexus-search-bar";
  bar.style.cssText = BAR_STYLES;

  // Find input
  const findInput = document.createElement("input");
  findInput.type = "text";
  findInput.placeholder = "Find...";
  findInput.style.cssText = INPUT_STYLES;

  // Fuzzy mode toggle
  const fuzzyBtn = document.createElement("button");
  fuzzyBtn.className = "nexus-search-fuzzy";
  fuzzyBtn.textContent = "Fz";
  fuzzyBtn.title = "Fuzzy subsequence search (Ctrl+Shift+F)";
  fuzzyBtn.style.cssText = BTN_STYLES;

  // Replace input
  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.placeholder = "Replace...";
  replaceInput.style.cssText = INPUT_STYLES;
  replaceInput.style.width = "160px";

  // Buttons
  const prevBtn = document.createElement("button");
  prevBtn.textContent = "↑"; // ↑
  prevBtn.title = "Previous match";
  prevBtn.style.cssText = BTN_STYLES;

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "↓"; // ↓
  nextBtn.title = "Next match";
  nextBtn.style.cssText = BTN_STYLES;

  const replaceBtn = document.createElement("button");
  replaceBtn.textContent = "Replace";
  replaceBtn.style.cssText = BTN_STYLES;

  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.textContent = "All";
  replaceAllBtn.title = "Replace all";
  replaceAllBtn.style.cssText = BTN_STYLES;

  // Count label
  const countLabel = document.createElement("span");
  countLabel.className = "nexus-search-count";
  countLabel.style.cssText = COUNT_STYLES;

  // Close
  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close (Esc)";
  closeBtn.style.cssText = CLOSE_BTN_STYLES;

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  bar.append(findInput, fuzzyBtn, prevBtn, nextBtn, countLabel, replaceInput, replaceBtn, replaceAllBtn, spacer, closeBtn);

  // Fuzzy match preview row: shows the match window with each matched
  // character marked, plus the algorithm's score — makes subsequence
  // matching visible instead of magic.
  const previewRow = document.createElement("div");
  previewRow.className = "nexus-search-preview";
  previewRow.style.cssText = PREVIEW_STYLES;

  wrapper.append(bar, previewRow);

  // State
  let matches: Array<{ from: number; to: number }> = [];
  let fuzzyMatches: FuzzyMatch[] = [];
  let currentIdx = -1;
  let visible = false;
  let fuzzyMode = false;
  let searchTimer: number | undefined;

  function applyFuzzyButtonStyle() {
    fuzzyBtn.style.cssText = BTN_STYLES + (fuzzyMode ? FUZZY_BTN_ACTIVE_STYLES : "");
  }

  function setFuzzyMode(next: boolean) {
    if (fuzzyMode === next) return;
    fuzzyMode = next;
    applyFuzzyButtonStyle();
    updateMatches();
  }

  function renderPreview() {
    previewRow.textContent = "";
    if (!fuzzyMode || currentIdx < 0 || currentIdx >= fuzzyMatches.length) {
      previewRow.style.display = "none";
      return;
    }

    const m = fuzzyMatches[currentIdx];
    const doc = editor.getDocument();
    const ctxFrom = Math.max(0, m.from - PREVIEW_CONTEXT_CHARS);
    const ctxTo = Math.min(doc.length, m.to + PREVIEW_CONTEXT_CHARS);
    const hit = new Set(m.positions);

    if (ctxFrom > 0) previewRow.append("…");
    // Iterate by code point so astral characters never split into tofu.
    for (let i = ctxFrom; i < ctxTo; ) {
      const cp = doc.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      if (hit.has(i)) {
        const mark = document.createElement("mark");
        mark.textContent = ch;
        mark.style.cssText = MARK_STYLES;
        previewRow.append(mark);
      } else {
        previewRow.append(document.createTextNode(ch));
      }
      i += cp > 0xffff ? 2 : 1;
    }
    if (ctxTo < doc.length) previewRow.append("…");

    const score = document.createElement("span");
    score.textContent = `score ${m.score} · ${m.from}–${m.to}`;
    score.style.cssText = SCORE_STYLES;
    previewRow.append(score);

    previewRow.style.display = "block";
  }

  function updateMatches() {
    const query = findInput.value;
    if (!query) {
      matches = [];
      fuzzyMatches = [];
      currentIdx = -1;
      countLabel.textContent = "";
      renderPreview();
      return;
    }
    const doc = editor.getDocument();
    if (fuzzyMode) {
      fuzzyMatches = findFuzzyMatches(doc, query);
      matches = fuzzyMatches;
    } else {
      fuzzyMatches = [];
      matches = findSearchMatches(doc, query);
    }
    if (matches.length === 0) {
      currentIdx = -1;
      countLabel.textContent = "0 results";
      renderPreview();
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

  function scheduleUpdate() {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(updateMatches, SEARCH_DEBOUNCE_MS);
  }

  function highlightCurrent() {
    if (currentIdx < 0 || currentIdx >= matches.length) {
      renderPreview();
      return;
    }
    const m = matches[currentIdx];
    editor.setSelection(m.from, m.to);
    editor.focus();
    countLabel.textContent = `${currentIdx + 1} / ${matches.length}`;
    renderPreview();
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
    const newDoc = replaceAllMatches(doc, query, replaceInput.value, { fuzzy: fuzzyMode });
    editor.setDocument(newDoc);
    updateMatches();
  }

  // Event handlers
  findInput.addEventListener("input", scheduleUpdate);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { updateMatches(); e.shiftKey ? goPrev() : goNext(); e.preventDefault(); }
    if (e.key === "Escape") { close(); }
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { doReplace(); e.preventDefault(); }
    if (e.key === "Escape") { close(); }
  });
  fuzzyBtn.addEventListener("click", () => setFuzzyMode(!fuzzyMode));
  nextBtn.addEventListener("click", goNext);
  prevBtn.addEventListener("click", goPrev);
  replaceBtn.addEventListener("click", doReplace);
  replaceAllBtn.addEventListener("click", doReplaceAll);
  closeBtn.addEventListener("click", close);

  function open(opts?: { fuzzy?: boolean }) {
    if (opts?.fuzzy) setFuzzyMode(true);
    if (visible) { findInput.focus(); findInput.select(); return; }
    visible = true;
    wrapper.style.display = "flex";
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
    window.clearTimeout(searchTimer);
    visible = false;
    wrapper.style.display = "none";
    matches = [];
    fuzzyMatches = [];
    currentIdx = -1;
    countLabel.textContent = "";
    renderPreview();
    editor.focus();
  }

  return {
    element: wrapper,
    open,
    close,
    isOpen: () => visible,
    destroy() {
      close();
      wrapper.remove();
    },
  };
}
