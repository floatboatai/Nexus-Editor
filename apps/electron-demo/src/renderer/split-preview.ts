import { attachSyncScroll, type EditorAPI } from "@floatboat/nexus-core";

export interface SplitPreviewPane {
  element: HTMLElement;
  setEnabled(enabled: boolean): void;
  updateFromEditor(editor: EditorAPI): void;
  destroy(): void;
}

export function createSplitPreviewPane(editor: EditorAPI): SplitPreviewPane {
  const root = document.createElement("aside");
  root.className = "split-preview-pane";
  root.hidden = true;

  const header = document.createElement("div");
  header.className = "split-preview-header";
  header.textContent = "Preview";

  const scroll = document.createElement("div");
  scroll.className = "split-preview-scroll";

  const content = document.createElement("div");
  content.className = "split-preview-content";
  scroll.appendChild(content);
  root.append(header, scroll);

  let syncHandle: ReturnType<typeof attachSyncScroll> | null = null;

  const wireSync = (): void => {
    syncHandle?.destroy();
    syncHandle = null;

    const editorScroll = editor.getScrollElement();
    if (!editorScroll || root.hidden) {
      return;
    }

    syncHandle = attachSyncScroll({
      primary: editorScroll,
      secondary: scroll,
    });
  };

  return {
    element: root,
    setEnabled(enabled) {
      root.hidden = !enabled;
      if (enabled) {
        wireSync();
      } else {
        syncHandle?.destroy();
        syncHandle = null;
      }
    },
    updateFromEditor(ed) {
      content.innerHTML = ed.exportHTML();
      wireSync();
    },
    destroy() {
      syncHandle?.destroy();
      syncHandle = null;
      root.remove();
    },
  };
}
