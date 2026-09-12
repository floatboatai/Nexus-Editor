import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  NexusPluginBase,
  NexusPluginError,
  UI_CAPABILITY,
  type AuthorPluginManifest,
  type CommandService,
  type EditorContext,
  type EditorHostService,
  type NexusApp,
  type NormalizedPluginManifest,
  type WindowId,
} from "@floatboat/nexus-plugin-api";
import type { NexusPlugin } from "@floatboat/nexus-core";
import { createFormattingRuntimeSlashContribution, formattingCommands, type FormattingCommand } from "@floatboat/nexus-plugin-formatting";

export interface ToolbarLifecyclePluginOptions {
  /** Keep compatibility command entrypoints available without claiming a UI slot. */
  readonly mountUi?: boolean;
}

const TOOLBAR_COMMANDS: readonly FormattingCommand[] = [
  { id: "undo", name: "Undo", run: (editor) => editor.undo() },
  { id: "redo", name: "Redo", run: (editor) => editor.redo() },
  ...formattingCommands,
];

export const toolbarLifecyclePluginManifest = Object.freeze({
  schemaVersion: 1,
  id: "toolbar",
  name: "Formatting Toolbar",
  version: "1.0.0",
  entrypoint: "toolbar.js",
  apiVersion: "^1.0.0",
  requiredCapabilities: [
    { id: COMMANDS_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    { id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
  ],
  optionalCapabilities: [
    { id: UI_CAPABILITY.id, version: "^1.0.0", scope: "window" as const },
  ],
} satisfies AuthorPluginManifest);

/** Compatibility catalogue for hosts that still use toolbar command IDs. */
export function createToolbarRuntimeSlashContribution(
  commandOwner = toolbarLifecyclePluginManifest.id,
): NexusPlugin {
  return { ...createFormattingRuntimeSlashContribution(commandOwner), name: "plugin-toolbar-runtime-slash-catalogue" };
}

/** Global toolbar UI. Shared formatting is supplied by FormattingLifecyclePlugin. */
export class ToolbarLifecyclePlugin extends NexusPluginBase {
  private readonly mountUi: boolean;
  private readonly uiWindows = new Set<WindowId>();

  constructor(
    app: NexusApp,
    manifest: NormalizedPluginManifest,
    options: ToolbarLifecyclePluginOptions = {},
  ) {
    super(app, manifest);
    this.mountUi = options.mountUi ?? true;
  }

  override onload(): void {
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");

    for (const command of TOOLBAR_COMMANDS) {
      const isHistory = command.id === "undo" || command.id === "redo";
      const result = commands.registerCommand({
        id: command.id,
        name: command.name,
        ...(isHistory ? {} : { showInCommandPalette: false }),
        editorCheckCallback: async (checking, context, source) => {
          if (isHistory) {
            if (!checking) command.run(context.editor);
            return true;
          }
          const commandId = `formatting:${command.id}`;
          const invocation = { ...source, editor: context };
          if (checking) return (await commands.checkCommand(commandId, invocation)).status === "available";
          const result = await commands.executeCommand(commandId, invocation);
          if (!result.ok) throw new NexusPluginError(result.diagnostic);
          return true;
        },
      });
      this.reportFailure(result);
    }

    if (!this.mountUi) return;
    for (const context of editors.list()) {
      this.mountWindowUi(commands, editors, context);
    }
    editors.events.on("attached", (context) => this.mountWindowUi(commands, editors, context));
  }

  override onunload(): void {
    this.uiWindows.clear();
  }

  private mountWindowUi(
    commands: CommandService,
    editors: EditorHostService,
    context: EditorContext,
  ): void {
    if (!context.window || this.uiWindows.has(context.window.id)) return;
    const ui = this.app.capabilities.get(UI_CAPABILITY, "^1.0.0", {
      windowId: context.window.id,
    });
    if (!ui) return;

    this.uiWindows.add(context.window.id);
    for (const action of TOOLBAR_COMMANDS) {
      const commandId = action.id === "undo" || action.id === "redo"
        ? `${this.identity.id}:${action.id}`
        : `formatting:${action.id}`;
      const result = ui.registerAction("editor-toolbar", {
        id: action.id,
        label: action.name,
        tooltip: action.name,
        commandId,
        action: async (source) => {
          const editor = source.editor ?? editors.getRecent();
          await commands.executeCommand(commandId, {
            trigger: "ui",
            editor,
            ...(editor ? { sourceId: editor.editorId } : {}),
          });
        },
      });
      this.reportFailure(result);
    }
  }

  private reportFailure(result: { readonly ok: boolean; readonly diagnostic?: unknown }): void {
    if (!result.ok && result.diagnostic) {
      this.app.diagnostics.report(result.diagnostic as never);
    }
  }
}
