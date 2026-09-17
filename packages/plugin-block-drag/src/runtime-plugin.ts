import { ViewPlugin, type EditorView } from "@codemirror/view";
import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  NexusPluginBase,
  NexusPluginError,
  type AuthorPluginManifest,
  type EditorId,
} from "@floatboat/nexus-plugin-api";

import {
  canMoveBlock,
  createBlockDragExtension,
  moveBlock,
  stopBlockDrag,
} from "./extension";

export const blockDragLifecyclePluginManifest = Object.freeze({
  schemaVersion: 1,
  id: "block-drag",
  name: "Block Drag",
  version: "1.0.0",
  entrypoint: "block-drag.js",
  apiVersion: "^1.0.0",
  requiredCapabilities: [
    { id: COMMANDS_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    { id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
  ],
} satisfies AuthorPluginManifest);

/** Runtime hotkeys belong to the command service, including user overrides. */
export class BlockDragLifecyclePlugin extends NexusPluginBase {
  private readonly views = new Map<EditorId, EditorView>();

  override onload(): void {
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");

    // Quiesce pointer sessions before owner disposal starts removing extensions.
    this.register({
      quiesce: () => {
        for (const view of this.views.values()) stopBlockDrag(view);
      },
      dispose: () => this.views.clear(),
    });

    const views = this.views;
    const extension = editors.registerEditorExtension((context) => [
      createBlockDragExtension({ keyboard: false }),
      ViewPlugin.define((view) => {
        views.set(context.editorId, view);
        return {
          destroy() {
            if (views.get(context.editorId) === view) views.delete(context.editorId);
          },
        };
      }),
    ], { id: "block-drag" });
    if (!extension.ok) throw new NexusPluginError(extension.diagnostic);

    for (const direction of [-1, 1] as const) {
      const up = direction === -1;
      const result = commands.registerCommand({
        id: up ? "move-up" : "move-down",
        name: up ? "Move block up" : "Move block down",
        defaultHotkeys: [{
          key: up ? "ArrowUp" : "ArrowDown",
          modifiers: ["Alt", "Shift"],
        }],
        editorCheckCallback: (checking, context) => {
          const view = this.views.get(context.editorId);
          if (!view) return false;
          return checking ? canMoveBlock(view, direction) : moveBlock(view, direction);
        },
      });
      if (!result.ok) throw new NexusPluginError(result.diagnostic);
    }
  }
}
