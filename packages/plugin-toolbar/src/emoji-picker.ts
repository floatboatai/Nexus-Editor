/**
 * Emoji Picker for the Nexus Editor toolbar.
 * Provides a searchable popup panel with categorized emoji.
 */
import type { EditorAPI } from "@floatboat/nexus-core";

export interface EmojiCategory {
  name: string;
  emojis: string[];
}

/** Common emoji subset organized by category (~200 emojis). */
export const EMOJI_DATA: EmojiCategory[] = [
  {
    name: "Smileys",
    emojis: ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😋", "😛", "😜", "🤪", "😝", "🤗", "🤭", "🫢", "🤫", "🤔", "🫡", "🤐", "🤨", "😐", "😑", "😶", "🫠", "😏", "😒", "🙄", "😬", "🤥"],
  },
  {
    name: "Gestures",
    emojis: ["👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞", "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️", "🫵", "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐", "🤲", "🤝", "🙏"],
  },
  {
    name: "Nature",
    emojis: ["🌸", "🌺", "🌻", "🌹", "🌷", "🌱", "🌲", "🌳", "🌴", "🌵", "🍀", "🍁", "🍂", "🍃", "🌿", "☘️", "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯", "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦋", "🐛"],
  },
  {
    name: "Objects",
    emojis: ["📝", "📖", "📚", "📓", "📒", "📃", "📜", "📄", "📰", "🗞️", "📑", "🔖", "💻", "🖥️", "🖨️", "⌨️", "🖱️", "📱", "📷", "🎥", "🎬", "📺", "📻", "⏰", "⏱️", "🔔", "🔑", "🗝️", "🔒", "🔓", "💡", "🔦", "🏮"],
  },
  {
    name: "Symbols",
    emojis: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔", "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "⭐", "🌟", "✨", "⚡", "🔥", "💥", "🎉", "🎊", "✅", "❌", "⚠️", "🚫", "♻️", "🔄", "➡️", "⬅️", "⬆️", "⬇️"],
  },
];

/**
 * Create and show an emoji picker popup attached to a button element.
 * When an emoji is clicked, it's inserted at the editor's cursor.
 */
export function showEmojiPicker(
  anchor: HTMLElement,
  editor: EditorAPI,
  onClose?: () => void
): HTMLElement {
  const container = document.createElement("div");
  container.className = "nexus-emoji-picker";
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", "Emoji picker");

  // Search input
  const search = document.createElement("input");
  search.type = "text";
  search.className = "nexus-emoji-picker-search";
  search.placeholder = "Search emoji...";
  container.appendChild(search);

  // Category grid
  const grid = document.createElement("div");
  grid.className = "nexus-emoji-picker-grid";
  container.appendChild(grid);

  function renderEmojis(filter?: string) {
    grid.innerHTML = "";
    for (const category of EMOJI_DATA) {
      const emojis = filter
        ? category.emojis.filter(() => category.name.toLowerCase().includes(filter.toLowerCase()))
        : category.emojis;
      if (emojis.length === 0 && filter) continue;

      const displayEmojis = filter ? category.emojis : emojis;
      for (const emoji of displayEmojis) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nexus-emoji-picker-item";
        btn.textContent = emoji;
        btn.title = emoji;
        btn.addEventListener("click", () => {
          editor.replaceSelection(emoji);
          editor.focus();
          close();
        });
        grid.appendChild(btn);
      }
    }
  }

  search.addEventListener("input", () => {
    renderEmojis(search.value.trim());
  });

  renderEmojis();

  // Position relative to anchor
  const rect = anchor.getBoundingClientRect();
  container.style.position = "fixed";
  container.style.left = `${rect.left}px`;
  container.style.top = `${rect.bottom + 4}px`;
  container.style.zIndex = "9999";

  document.body.appendChild(container);

  function close() {
    container.remove();
    document.removeEventListener("mousedown", outsideClick);
    onClose?.();
  }

  function outsideClick(e: MouseEvent) {
    if (!container.contains(e.target as Node) && e.target !== anchor) {
      close();
    }
  }

  setTimeout(() => document.addEventListener("mousedown", outsideClick), 0);
  search.focus();

  return container;
}
