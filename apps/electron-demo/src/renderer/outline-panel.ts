import type { EditorAPI, TocEntry } from "@floatboat/nexus-core";

export interface OutlinePanel {
  element: HTMLElement;
  update(): void;
  destroy(): void;
}

export function createOutlinePanel(editor: EditorAPI): OutlinePanel {
  const panel = document.createElement("div");
  panel.className = "nx-rail nexus-outline-panel";

  const header = document.createElement("div");
  header.className = "nx-panel-header";

  const title = document.createElement("div");
  title.className = "nx-panel-title";
  title.textContent = "Outline";
  header.appendChild(title);

  const list = document.createElement("div");
  list.className = "nx-panel-body";

  panel.append(header, list);

  function renderItems(entries: TocEntry[]) {
    list.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "nx-empty-hint";
      empty.textContent = "No headings yet";
      list.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = entry.text;
      item.title = entry.text;
      item.className = `nx-outline-item nx-outline-item--h${Math.min(entry.level, 3)}`;
      item.style.paddingLeft = `${14 + (entry.level - 1) * 12}px`;

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
