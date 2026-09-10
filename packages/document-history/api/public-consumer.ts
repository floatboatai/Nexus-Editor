import type { EditorAPI } from "@floatboat/nexus-core";
import {
  MemoryDocumentVersionStore,
  checkpointDocument,
  diffDocumentText,
  restoreDocumentVersion,
  type DocumentHistorySnapshot,
  type DocumentVersionStore,
} from "../dist/index.js";

const memory = new MemoryDocumentVersionStore();
const store: DocumentVersionStore = memory;
const snapshot: DocumentHistorySnapshot = memory.exportSnapshot();
const restored = new MemoryDocumentVersionStore({ snapshot });
async function consumeEditor(editor: EditorAPI) {
  const checkpoint = await checkpointDocument(editor, store, { documentKey: "opaque-host-key" });
  const revision = editor.getDocumentRevision?.();
  if (checkpoint.status === "appended" && revision) {
    await restoreDocumentVersion(editor, store, {
      documentKey: "opaque-host-key", versionId: checkpoint.version.id, expectedRevision: revision,
    });
  }
}
void consumeEditor;
void restored;
void diffDocumentText("before", "after");
