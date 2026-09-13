import {
  EDITOR_HOST_CAPABILITY,
  NexusPluginBase,
  type AuthorPluginManifest,
} from "@floatboat/nexus-plugin-api";
import { buildBlockDragExtension, type BlockDragView } from "./extension";

export const blockDragLifecyclePluginManifest = Object.freeze({
  schemaVersion: 1,
  id: "block-drag",
  name: "Block Reordering",
  version: "1.0.0",
  entrypoint: "block-drag.js",
  apiVersion: "^1.0.0",
  platforms: ["desktop", "web"],
  requiredCapabilities: [{ id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" }],
} satisfies AuthorPluginManifest);

export class BlockDragLifecyclePlugin extends NexusPluginBase {
  private readonly views = new Set<BlockDragView>();

  override onload(): void {
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");
    this.register({ quiesce: () => this.stopViews(), dispose: () => this.stopViews() });
    const result = editors.registerEditorExtension(() => buildBlockDragExtension({}, this.views), { id: "block-drag" });
    if (!result.ok) this.app.diagnostics.report(result.diagnostic);
  }

  private stopViews(): void {
    for (const view of this.views) view.stop();
  }
}
