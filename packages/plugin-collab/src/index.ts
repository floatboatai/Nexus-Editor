import { type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import type { NexusPlugin } from "@floatboat/nexus-core";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import * as Y from "yjs";

import { setUserAwareness } from "./awareness";
import type { CollabPluginOptions } from "./types";

export * from "./types";
export * from "./awareness";
export * from "./provider";

/**
 * Creates the real-time CRDT collaboration plugin powered by Yjs.
 *
 * Synchronizes the document in real time across multiple concurrent users,
 * visualizes remote user presence and cursors, and scopes undo/redo to only
 * local client edits.
 *
 * @example
 * ```typescript
 * import * as Y from "yjs";
 * import { createEditor } from "@floatboat/nexus-core";
 * import { createCollabPlugin } from "@floatboat/nexus-plugin-collab";
 *
 * const ydoc = new Y.Doc();
 * const ytext = ydoc.getText("markdown");
 *
 * const editor = createEditor({
 *   container: document.getElementById("editor")!,
 *   plugins: [
 *     createCollabPlugin({
 *       ytext,
 *       user: { name: "Alice", color: "#2563eb" },
 *     }),
 *   ],
 * });
 * ```
 */
export function createCollabPlugin(options: CollabPluginOptions): NexusPlugin {
  if (!options || !options.ytext) {
    throw new Error("createCollabPlugin requires a valid Y.Text instance in `options.ytext`");
  }

  // Seed initial value into Y.Text if empty
  if (options.initialValue && options.ytext.length === 0) {
    options.ytext.insert(0, options.initialValue);
  }

  // Set up awareness user state if provided
  if (options.awareness && options.user) {
    setUserAwareness(options.awareness, options.user);
  }

  // Set up collaborative UndoManager
  const undoManager =
    options.undoManager === false
      ? false
      : options.undoManager ?? new Y.UndoManager(options.ytext);

  const cmExtensions: Extension[] = [
    yCollab(options.ytext, options.awareness ?? null, {
      undoManager: undoManager !== false ? undoManager : undefined,
    }),
  ];

  if (undoManager !== false) {
    cmExtensions.push(keymap.of(yUndoManagerKeymap));
  }

  return {
    name: "plugin-collab",
    cmExtensions,
  };
}
