import { createEditor, type EditorAPI, type EditorConfig, type LivePreviewConfig } from "@floatboat/nexus-core";
import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

import { createBinding } from "./binding";
import { createPresence } from "./presence";
import { isWellFormed } from "./unicode";

export interface CollaborativeEditorConfig extends Omit<EditorConfig, "initialValue"> {
  /** Host-owned, attached plain-text shared type. Seed it once before joining. */
  text: Y.Text;
  /** Optional host-owned awareness. Its document must match text.doc. */
  awareness?: Awareness;
  /** Local edits within this interval form an undo group. Default: 500 ms. */
  captureTimeout?: number;
}

export interface CollaborativeEditorAPI extends EditorAPI {
  /** Start a new undo group, for example before inserting a template. */
  stopCapturing(): void;
}

function collaborativePreview(config: EditorConfig["livePreview"]): EditorConfig["livePreview"] {
  if (!config) return config;
  const preview: LivePreviewConfig = config === true ? {} : config;
  return { ...preview, tableMode: "source" };
}

/** Create a Markdown editor backed by a host-owned Yjs document. */
export function createCollaborativeEditor(config: CollaborativeEditorConfig): CollaborativeEditorAPI {
  const { text, awareness, captureTimeout = 500, ...editorConfig } = config;
  if (!text.doc || text.doc.isDestroyed) {
    throw new TypeError("Collaboration requires a Y.Text attached to a live Y.Doc");
  }
  if (text.toDelta().some((part: { insert: unknown; attributes?: unknown }) => typeof part.insert !== "string" || part.attributes)) {
    throw new TypeError("Collaborative Markdown requires plain text without embeds or formatting attributes");
  }
  if (awareness && awareness.doc !== text.doc) {
    throw new TypeError("Awareness and Y.Text must belong to the same Y.Doc");
  }
  if (!isWellFormed(text.toString())) {
    throw new TypeError("The shared document must contain well-formed Unicode");
  }
  if (!Number.isFinite(captureTimeout) || captureTimeout < 0) {
    throw new RangeError("captureTimeout must be a finite non-negative number");
  }

  const binding = createBinding(text, captureTimeout);
  const editor = createEditor({
    ...editorConfig,
    initialValue: text.toString(),
    livePreview: collaborativePreview(editorConfig.livePreview),
    plugins: [
      ...(editorConfig.plugins ?? []),
      {
        name: "plugin-collab",
        cmExtensions: [binding.extension, ...(awareness ? [createPresence(text, awareness)] : [])],
      },
    ],
  });
  return Object.assign(editor, { stopCapturing: binding.stopCapturing });
}
