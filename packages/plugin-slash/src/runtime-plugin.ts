import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  NexusPluginBase,
  type AuthorPluginManifest,
  type CommandService,
  type EditorContext,
  type EditorHostService,
  type ManagedResource,
  type NexusApp,
  type NormalizedPluginManifest,
} from "@floatboat/nexus-plugin-api";

import { createSlashMenuUI, type SlashMenuLabels, type SlashMenuUI } from "./menu-ui";

export interface SlashLifecyclePluginOptions {
  /** Host feature flag. False means this owner registers nothing. */
  readonly enabled?: boolean;
  readonly labels?: Partial<Omit<SlashMenuLabels, "commands">> & {
    commands?: SlashMenuLabels["commands"];
  };
}

export const slashLifecyclePluginManifest = Object.freeze({
  schemaVersion: 1,
  id: "slash-menu",
  name: "Slash Menu",
  version: "1.0.0",
  entrypoint: "slash-menu.js",
  apiVersion: "^1.0.0",
  requiredCapabilities: [
    { id: COMMANDS_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    { id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
  ],
} satisfies AuthorPluginManifest);

/**
 * One slash menu per attached editor. Menu DOM belongs to the editor window,
 * command execution routes through the unified command registry, and the
 * capture hook is disposed with the plugin owner.
 */
export class SlashLifecyclePlugin extends NexusPluginBase {
  private readonly enabled: boolean;
  private labels: SlashLifecyclePluginOptions["labels"];
  private readonly menus = new Map<string, {
    readonly menu: SlashMenuUI;
    dispose(): Promise<void>;
  }>();

  constructor(
    app: NexusApp,
    manifest: NormalizedPluginManifest,
    options: SlashLifecyclePluginOptions = {},
  ) {
    super(app, manifest);
    this.enabled = options.enabled ?? true;
    this.labels = options.labels;
  }

  override onload(): void {
    if (!this.enabled) return;
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");
    for (const context of editors.list()) this.attachMenu(commands, editors, context);
    editors.events.on("attached", (context) => {
      this.attachMenu(commands, editors, context);
    });
    editors.events.on("detached", ({ editorId }) => {
      void this.menus.get(editorId)?.dispose();
    });
  }

  override onunload(): void {
    this.menus.clear();
  }

  get mountedEditorIds(): readonly string[] {
    return Object.freeze([...this.menus.keys()]);
  }

  setLabels(labels: SlashLifecyclePluginOptions["labels"]): void {
    this.labels = labels;
    for (const entry of this.menus.values()) entry.menu.setLabels(labels);
  }

  private attachMenu(
    commands: CommandService,
    editors: EditorHostService,
    context: EditorContext,
  ): void {
    if (this.menus.has(context.editorId)) return;
    let menu: SlashMenuUI | null = null;
    const menuResource: ManagedResource = {
      activate: () => {
        if (menu) return;
        const document = context.window?.ownerDocument ?? context.surface.root.ownerDocument;
        menu = createSlashMenuUI(context.editor, {
          container: document.body,
          manageKeyboard: false,
          labels: this.labels,
          onCommand: (command) => {
            const globalId = command.id.includes(":")
              ? command.id
              : `${this.identity.id}:${command.id}`;
            if (commands.getCommand(globalId)) {
              void commands.executeCommand(globalId, {
                trigger: "ui",
                editor: context,
                sourceId: context.editorId,
              });
              return;
            }
            command.run?.(context.editor);
          },
        });
      },
      quiesce: () => menu?.destroy(),
      dispose: () => {
        menu?.destroy();
        menu = null;
        this.menus.delete(context.editorId);
      },
    };
    const menuRegistration = this.register(menuResource);
    const hook = editors.registerDomEvent("keydown", (event) => {
      return menu?.handleKeydown(event) ? "consume" : "pass";
    }, {
      phase: "capture",
      priority: 50,
      matches: (candidate) => candidate.editorId === context.editorId,
    });
    if (!hook.ok) {
      void menuRegistration.dispose();
      this.app.diagnostics.report(hook.diagnostic);
      return;
    }

    let disposal: Promise<void> | null = null;
    this.menus.set(context.editorId, {
      get menu() {
        if (!menu) throw new Error("Slash menu has not activated");
        return menu;
      },
      dispose: () => {
        if (!disposal) {
          disposal = Promise.all([
            hook.registration.dispose(),
            menuRegistration.dispose(),
          ]).then(() => undefined);
        }
        return disposal;
      },
    });
  }
}
