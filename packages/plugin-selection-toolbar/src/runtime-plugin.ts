import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  NexusPluginBase,
  NexusPluginError,
  type AuthorPluginManifest,
  type CommandService,
  type EditorContext,
  type EditorHostService,
  type ManagedResource,
  type NexusApp,
  type NormalizedPluginManifest,
} from "@floatboat/nexus-plugin-api";
import { createSelectionToolbarUI, type SelectionToolbarUI } from "./selection-toolbar-ui";
import type { SelectionToolbarButton, SelectionToolbarGroup } from "./toolbar-dom";

export interface SelectionToolbarCommandButton extends Omit<SelectionToolbarButton, "action"> {
  commandId: string;
}

export interface SelectionToolbarCommandGroup {
  buttons: SelectionToolbarCommandButton[];
}

export interface SelectionToolbarLifecyclePluginOptions {
  /** Commands, direct actions, and presentation metadata are supplied by the host. */
  groups?: (SelectionToolbarCommandGroup | SelectionToolbarGroup)[];
  focusShortcut?: boolean;
}

export const selectionToolbarLifecyclePluginManifest = Object.freeze({
  schemaVersion: 1,
  id: "selection-toolbar",
  name: "Selection Toolbar",
  version: "1.0.0",
  entrypoint: "selection-toolbar.js",
  apiVersion: "^1.0.0",
  requiredCapabilities: [
    { id: COMMANDS_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    { id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
  ],
} satisfies AuthorPluginManifest);

/** One selection toolbar per source editor, independently owned and configured. */
export class SelectionToolbarLifecyclePlugin extends NexusPluginBase {
  private readonly groups: (SelectionToolbarCommandGroup | SelectionToolbarGroup)[];
  private readonly focusShortcut: boolean;
  private readonly toolbars = new Map<string, { dismiss(): void; dispose(): Promise<void> }>();

  constructor(
    app: NexusApp,
    manifest: NormalizedPluginManifest,
    options: SelectionToolbarLifecyclePluginOptions = {},
  ) {
    super(app, manifest);
    this.groups = options.groups ?? [];
    this.focusShortcut = options.focusShortcut ?? false;
  }

  override onload(): void {
    if (!this.groups.some((group) => group.buttons.length)) return;
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");
    for (const context of editors.list()) this.mountUi(commands, editors, context);
    editors.events.on("attached", (context) => this.mountUi(commands, editors, context));
    editors.events.on("detached", ({ editorId }) => { void this.toolbars.get(editorId)?.dispose(); });
    editors.events.on("contextChanged", ({ editorId }) => this.toolbars.get(editorId)?.dismiss());
  }

  override onunload(): void {
    this.toolbars.clear();
  }

  private mountUi(commands: CommandService, editors: EditorHostService, context: EditorContext): void {
    if (this.toolbars.has(context.editorId)) return;
    let ui: SelectionToolbarUI | null = null;
    const resource: ManagedResource = {
      activate: async () => {
        ui = createSelectionToolbarUI(context.editor, {
          editorRoot: context.surface.root,
          focusShortcut: this.focusShortcut,
          groups: this.groups.map((group) => ({
            buttons: group.buttons.map((button): SelectionToolbarButton => "commandId" in button ? ({
              ...button,
              action: async (_editor, signal) => {
                const source = editors.get(context.editorId);
                if (!source || signal.aborted) return;
                const result = await commands.executeCommand(button.commandId, {
                  trigger: "ui", editor: source, sourceId: context.editorId, signal,
                });
                if (!result.ok && !signal.aborted) throw new NexusPluginError(result.diagnostic);
              },
            }) : button),
          })),
        });
        await ui.ready;
      },
      quiesce: () => ui?.destroy(),
      dispose: () => {
        ui?.destroy();
        this.toolbars.delete(context.editorId);
      },
    };
    const registration = this.register(resource);
    this.toolbars.set(context.editorId, {
      dismiss: () => ui?.dismiss(),
      dispose: () => registration.dispose(),
    });
  }
}
