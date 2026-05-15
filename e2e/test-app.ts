import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createToolbarPlugin, createToolbarUI } from "@floatboat/nexus-plugin-toolbar";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";

const container = document.getElementById("editor-mount")!;

const editor = createEditor({
  container,
  initialValue: "Hello **world**",
  plugins: [
    createGfmPreset(),
    createHistoryPlugin(),
    createToolbarPlugin(),
    createSearchPlugin(),
  ],
  livePreview: { enabled: true },
});

const toolbar = createToolbarUI(editor);
container.insertBefore(toolbar.element, container.firstChild);

(window as any).__nexusEditor = editor;
