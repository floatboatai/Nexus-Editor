import type { EditorAPI } from '@floatboat/nexus-webcomponent';
import './StatusBar.css';

export interface StatusBar {
  element: HTMLElement;
  destroy(): void;
}

export function createStatusBar(editor: EditorAPI): StatusBar {
  const bar = document.createElement("div");
  bar.className = "nexus-status-bar";
  bar.textContent = "Markdown";

  function update() {
    const doc = editor.getDocument();
    const { anchor } = editor.getSelection();
    
    let line = 1;
    let col = 1;
    
    for (let i = 0; i < anchor && i < doc.length; i++) {
      if (doc[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
    }

    bar.textContent = `Ln ${line}, Col ${col} · Markdown`;
  }

  editor.on("change", update);
  update();

  return {
    element: bar,
    destroy() {
      editor.off("change", update);
      bar.remove();
    },
  };
}