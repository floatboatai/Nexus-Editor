import type { EditorAPI, TocEntry } from '@floatboat/nexus-webcomponent';
import './OutlinePanel.css';

export interface OutlinePanel {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

export function createOutlinePanel(editor: EditorAPI): OutlinePanel {
  const panel = document.createElement("div");
  panel.className = "nexus-outline-panel";

  const header = document.createElement("div");
  header.className = "outline-header";
  header.textContent = "Outline";

  const list = document.createElement("div");
  list.className = "outline-list";

  panel.append(header, list);

  function renderItems(entries: TocEntry[]) {
    list.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "outline-empty";
      empty.textContent = "No headings";
      list.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = entry.text;
      item.title = entry.text;
      item.className = `outline-item h${entry.level}`;
      item.style.paddingLeft = (14 + (entry.level - 1) * 14) + "px";

      item.addEventListener("click", () => {
        editor.setSelection(entry.from);
        editor.focus();
      });

      list.appendChild(item);
    }
  }

  function update() {
    renderItems(editor.getTableOfContents());
  }

  update();
  editor.on("change", update);

  return {
    element: panel,
    update,
    destroy() {
      editor.off("change", update);
      panel.remove();
    },
  };
}