// Compile against the published declarations, without workspace source aliases.
import { createCollaborativeEditor, type CollaborativeEditorAPI, type CollaborativeEditorConfig } from "../dist/index.js";
import type { EditorAPI } from "@floatboat/nexus-core";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

const doc = new Y.Doc();
const config: CollaborativeEditorConfig = {
  container: document.createElement("div"),
  text: doc.getText("markdown"),
  awareness: new Awareness(doc),
  captureTimeout: 0,
  livePreview: { tableMode: "source" },
  onChange(markdown) { markdown.toUpperCase(); },
};
const editor: CollaborativeEditorAPI = createCollaborativeEditor(config);
const core: EditorAPI = editor;
editor.stopCapturing();
const didUndo: boolean = core.undo();
void didUndo;

// @ts-expect-error Shared text is mandatory.
createCollaborativeEditor({ container: config.container });
// @ts-expect-error Initialization belongs to the host-owned shared text.
createCollaborativeEditor({ ...config, initialValue: "duplicate seed" });
