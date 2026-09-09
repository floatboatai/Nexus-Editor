import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  NexusPluginBase,
  UI_CAPABILITY,
  type AuthorPluginManifest,
  type CommandService,
  type EditorContext,
  type EditorHostService,
  type NexusApp,
  type NormalizedPluginManifest,
  type UiSlotRegistration,
  type WindowId,
} from "@floatboat/nexus-plugin-api";
import type { EditorAPI } from "@floatboat/nexus-core";
import type { NexusPlugin } from "@floatboat/nexus-core";

import { colorDecorationExtension } from "./color-decoration";
import {
  insertCodeBlock,
  insertHorizontalRule,
  insertImage,
  toggleBlockquote,
  toggleOrderedList,
  toggleUnorderedList,
} from "./formatting";
import {
  insertLink,
  toggleBold,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
  toggleWrap,
  toolbarSlashCommands,
} from "./toolbar-commands";

export interface ToolbarLifecyclePluginOptions {
  /** When false, commands remain available but no toolbar slot is claimed. */
  readonly mountUi?: boolean;
  readonly labels?: Readonly<Record<string, string>>;
}

interface ToolbarAction {
  readonly id: string;
  readonly name: string;
  readonly run: (editor: EditorAPI) => boolean | void;
  readonly hotkey?: { readonly key: string; readonly modifiers?: readonly ("Mod" | "Shift")[] };
}

const ACTIONS: readonly ToolbarAction[] = Object.freeze([
  { id: "undo", name: "Undo", run: (editor) => editor.undo() },
  { id: "redo", name: "Redo", run: (editor) => editor.redo() },
  { id: "link", name: "Insert link", run: (editor) => insertLink(editor), hotkey: { key: "k", modifiers: ["Mod"] } },
  { id: "h1", name: "Heading 1", run: (editor) => toggleHeading(editor, 1), hotkey: { key: "1", modifiers: ["Mod"] } },
  { id: "h2", name: "Heading 2", run: (editor) => toggleHeading(editor, 2), hotkey: { key: "2", modifiers: ["Mod"] } },
  { id: "h3", name: "Heading 3", run: (editor) => toggleHeading(editor, 3), hotkey: { key: "3", modifiers: ["Mod"] } },
  { id: "bold", name: "Bold", run: (editor) => toggleBold(editor), hotkey: { key: "b", modifiers: ["Mod"] } },
  { id: "italic", name: "Italic", run: (editor) => toggleItalic(editor), hotkey: { key: "i", modifiers: ["Mod"] } },
  { id: "strikethrough", name: "Strikethrough", run: (editor) => toggleStrikethrough(editor), hotkey: { key: "s", modifiers: ["Mod", "Shift"] } },
  { id: "underline", name: "Underline", run: (editor) => toggleWrap(editor, "<u>") },
  { id: "inline-code", name: "Inline code", run: (editor) => toggleInlineCode(editor), hotkey: { key: "e", modifiers: ["Mod"] } },
  { id: "blockquote", name: "Blockquote", run: (editor) => toggleBlockquote(editor) },
  { id: "code-block", name: "Code block", run: (editor) => insertCodeBlock(editor) },
  { id: "olist", name: "Ordered list", run: (editor) => toggleOrderedList(editor) },
  { id: "ulist", name: "Unordered list", run: (editor) => toggleUnorderedList(editor) },
  { id: "image", name: "Insert image", run: (editor) => insertImage(editor) },
  { id: "hr", name: "Divider", run: (editor) => insertHorizontalRule(editor) },
]);

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

/**
 * Static parser catalogue for the runtime slash menu. It owns no commands,
 * hotkeys, DOM or editor extension; IDs point at the runtime command owner.
 */
export function createToolbarRuntimeSlashContribution(
  commandOwner = toolbarLifecyclePluginManifest.id,
): NexusPlugin {
  return {
    name: "plugin-toolbar-runtime-slash-catalogue",
    slashCommands: toolbarSlashCommands.map((command) => ({
      ...command,
      id: `${commandOwner}:${command.id}`,
      run: undefined,
    })),
  };
}

/** Runtime-native toolbar. The old `createToolbarPlugin()` factory stays intact. */
export class ToolbarLifecyclePlugin extends NexusPluginBase {
  private readonly mountUi: boolean;
  private readonly uiWindows = new Set<WindowId>();
  private readonly actionRegistrations: Array<{ id: string; registration: UiSlotRegistration }> = [];
  private labels: Readonly<Record<string, string>>;

  constructor(
    app: NexusApp,
    manifest: NormalizedPluginManifest,
    options: ToolbarLifecyclePluginOptions = {},
  ) {
    super(app, manifest);
    this.mountUi = options.mountUi ?? true;
    this.labels = { ...options.labels };
  }

  override onload(): void {
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");

    for (const action of ACTIONS) {
      const result = commands.registerCommand({
        id: action.id,
        name: action.name,
        editorCallback: ({ editor }) => {
          action.run(editor);
        },
        ...(action.hotkey ? { defaultHotkeys: [action.hotkey] } : {}),
      });
      this.reportFailure(result);
    }

    this.reportFailure(editors.registerEditorExtension(colorDecorationExtension(), {
      id: "color-decorations",
    }));

    if (!this.mountUi) return;
    for (const context of editors.list()) {
      this.mountWindowUi(commands, editors, context);
    }
    editors.events.on("attached", (context) => this.mountWindowUi(commands, editors, context));
  }

  override onunload(): void {
    this.uiWindows.clear();
    this.actionRegistrations.length = 0;
  }

  setLabels(labels: Readonly<Record<string, string>>): void {
    this.labels = { ...labels };
    for (const entry of this.actionRegistrations) {
      const action = ACTIONS.find((candidate) => candidate.id === entry.id);
      if (!action) continue;
      const label = this.labels[action.id] ?? action.name;
      this.reportFailure(entry.registration.update({ label, tooltip: label, ariaLabel: label }));
    }
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
    for (const action of ACTIONS) {
      const commandId = `${this.identity.id}:${action.id}`;
      const label = this.labels[action.id] ?? action.name;
      const result = ui.registerAction("editor-toolbar", {
        id: action.id,
        label,
        tooltip: label,
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
      if (result.ok) this.actionRegistrations.push({ id: action.id, registration: result.registration });
    }
  }

  private reportFailure(result: { readonly ok: boolean; readonly diagnostic?: unknown }): void {
    if (!result.ok && result.diagnostic) {
      this.app.diagnostics.report(result.diagnostic as never);
    }
  }
}
