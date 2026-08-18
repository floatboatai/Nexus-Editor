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
  type WindowId,
} from "@floatboat/nexus-plugin-api";
import { getLocale, type NexusLocale } from "@floatboat/nexus-core";
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
  createToolbarSlashCommands,
  insertLink,
  toggleBold,
  toggleHeading,
  toggleInlineCode,
  toggleItalic,
  toggleStrikethrough,
  toggleWrap,
} from "./toolbar-commands";

export interface ToolbarLifecyclePluginOptions {
  /** When false, commands remain available but no toolbar slot is claimed. */
  readonly mountUi?: boolean;
}

interface ToolbarAction {
  readonly id: string;
  readonly name: string;
  readonly run: (editor: EditorAPI) => boolean | void;
  readonly hotkey?: { readonly key: string; readonly modifiers?: readonly ("Mod" | "Shift")[] };
}

function createActions(locale: NexusLocale): ToolbarAction[] {
  return [
    { id: "undo", name: locale.toolbarUndo, run: (editor) => editor.undo() },
    { id: "redo", name: locale.toolbarRedo, run: (editor) => editor.redo() },
    { id: "link", name: locale.toolbarInsertLink, run: (editor) => insertLink(editor), hotkey: { key: "k", modifiers: ["Mod"] } },
    { id: "h1", name: locale.toolbarHeading1, run: (editor) => toggleHeading(editor, 1), hotkey: { key: "1", modifiers: ["Mod"] } },
    { id: "h2", name: locale.toolbarHeading2, run: (editor) => toggleHeading(editor, 2), hotkey: { key: "2", modifiers: ["Mod"] } },
    { id: "h3", name: locale.toolbarHeading3, run: (editor) => toggleHeading(editor, 3), hotkey: { key: "3", modifiers: ["Mod"] } },
    { id: "bold", name: locale.toolbarBold, run: (editor) => toggleBold(editor), hotkey: { key: "b", modifiers: ["Mod"] } },
    { id: "italic", name: locale.toolbarItalic, run: (editor) => toggleItalic(editor), hotkey: { key: "i", modifiers: ["Mod"] } },
    { id: "strikethrough", name: locale.toolbarStrikethrough, run: (editor) => toggleStrikethrough(editor), hotkey: { key: "s", modifiers: ["Mod", "Shift"] } },
    { id: "underline", name: locale.toolbarUnderline, run: (editor) => toggleWrap(editor, "<u>") },
    { id: "inline-code", name: locale.toolbarInlineCode, run: (editor) => toggleInlineCode(editor), hotkey: { key: "e", modifiers: ["Mod"] } },
    { id: "blockquote", name: locale.toolbarBlockquote, run: (editor) => toggleBlockquote(editor) },
    { id: "code-block", name: locale.toolbarCodeBlock, run: (editor) => insertCodeBlock(editor) },
    { id: "olist", name: locale.toolbarOrderedList, run: (editor) => toggleOrderedList(editor) },
    { id: "ulist", name: locale.toolbarUnorderedList, run: (editor) => toggleUnorderedList(editor) },
    { id: "image", name: locale.toolbarInsertImage, run: (editor) => insertImage(editor) },
    { id: "hr", name: locale.slashDivider, run: (editor) => insertHorizontalRule(editor) },
  ];
}

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
    slashCommands: createToolbarSlashCommands(getLocale()).map((command) => ({
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

    for (const action of createActions(getLocale())) {
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
    for (const action of createActions(getLocale())) {
      const commandId = `${this.identity.id}:${action.id}`;
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
