import type { EditorAPI } from "@floatboat/nexus-core";
import { findSearchMatches, replaceAllMatches } from "@floatboat/nexus-plugin-search";

export interface SearchBar {
  element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function createSearchBar(editor: EditorAPI): SearchBar {
  const bar = document.createElement("div");
  bar.className = "nx-search-bar nexus-search-bar";

  const findInput = document.createElement("input");
  findInput.type = "text";
  findInput.placeholder = "Find…";
  findInput.className = "nx-input";

  const replaceInput = document.createElement("input");
  replaceInput.type = "text";
  replaceInput.placeholder = "Replace…";
  replaceInput.className = "nx-input";
  replaceInput.style.width = "160px";

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "nx-btn nx-btn--ghost";
  prevBtn.textContent = "↑";
  prevBtn.title = "Previous match";

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "nx-btn nx-btn--ghost";
  nextBtn.textContent = "↓";
  nextBtn.title = "Next match";

  const replaceBtn = document.createElement("button");
  replaceBtn.type = "button";
  replaceBtn.className = "nx-btn nx-btn--ghost";
  replaceBtn.textContent = "Replace";

  const replaceAllBtn = document.createElement("button");
  replaceAllBtn.type = "button";
  replaceAllBtn.className = "nx-btn nx-btn--ghost";
  replaceAllBtn.textContent = "All";
  replaceAllBtn.title = "Replace all";

  const countLabel = document.createElement("span");
  countLabel.className = "nx-search-count";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "nx-btn nx-btn--icon";
  closeBtn.innerHTML = "&times;";
  closeBtn.title = "Close (Esc)";

  const spacer = document.createElement("div");
  spacer.style.flex = "1";

  bar.append(
    findInput,
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

  function updateMatches() {
    const query = findInput.value;
    if (!query) {
      matches = [];
      currentIdx = -1;
      countLabel.textContent = "";
      return;
    }
    const doc = editor.getDocument();
    matches = findSearchMatches(doc, query);
    if (matches.length === 0) {
      currentIdx = -1;
      countLabel.textContent = "0 results";
    } else {
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
    const newDoc = replaceAllMatches(doc, query, replaceInput.value);
    editor.setDocument(newDoc);
    updateMatches();
  }

  findInput.addEventListener("input", updateMatches);
  findInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.shiftKey ? goPrev() : goNext();
      e.preventDefault();
    }
    if (e.key === "Escape") close();
  });
  replaceInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      doReplace();
      e.preventDefault();
    }
    if (e.key === "Escape") close();
  });
  nextBtn.addEventListener("click", goNext);
  prevBtn.addEventListener("click", goPrev);
  replaceBtn.addEventListener("click", doReplace);
  replaceAllBtn.addEventListener("click", doReplaceAll);
  closeBtn.addEventListener("click", close);

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
