import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  HOTKEYS_CAPABILITY,
  NexusPluginBase,
  type AuthorPluginManifest,
} from "@floatboat/nexus-plugin-api";
import type { NexusPlugin } from "@floatboat/nexus-core";
import { colorDecorationExtension } from "./color-decoration";
import { formattingCommands } from "./command-definitions";
import { formattingSlashCommands } from "./slash-commands";

export const formattingLifecyclePluginManifest = Object.freeze({
  schemaVersion: 1,
  id: "formatting",
  name: "Markdown Formatting",
  version: "1.0.0",
  entrypoint: "formatting.js",
  apiVersion: "^1.0.0",
  requiredCapabilities: [
    { id: COMMANDS_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    { id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
  ],
  optionalCapabilities: [
    { id: HOTKEYS_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
  ],
} satisfies AuthorPluginManifest);

/** Static slash catalogue; command and extension ownership stays with the provider. */
export function createFormattingRuntimeSlashContribution(commandOwner = formattingLifecyclePluginManifest.id): NexusPlugin {
  return {
    name: "plugin-formatting-runtime-slash-catalogue",
    slashCommands: formattingSlashCommands.map((command) => ({
      ...command,
      id: `${commandOwner}:${command.id}`,
      run: undefined,
    })),
  };
}

/** Shared formatting commands and decorations, independent of toolbar UI. */
export class FormattingLifecyclePlugin extends NexusPluginBase {
  override async onload(): Promise<void> {
    await this.migrateToolbarHotkeys();
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");
    for (const command of formattingCommands) {
      const result = commands.registerCommand({
        id: command.id,
        name: command.name,
        editorCallback: ({ editor }) => { command.run(editor); },
        ...(command.hotkey ? { defaultHotkeys: [command.hotkey] } : {}),
      });
      if (!result.ok) this.app.diagnostics.report(result.diagnostic);
    }
    const result = editors.registerEditorExtension(colorDecorationExtension(), { id: "color-decorations" });
    if (!result.ok) this.app.diagnostics.report(result.diagnostic);
  }

  private async migrateToolbarHotkeys(): Promise<void> {
    const hotkeys = this.app.capabilities.get(HOTKEYS_CAPABILITY, "^1.0.0");
    if (!hotkeys) return;
    for (const command of formattingCommands) {
      const previousId = `toolbar:${command.id}`;
      const currentId = `${this.identity.id}:${command.id}`;
      const previous = hotkeys.getPreference(previousId);
      if (previous.mode === "default") continue;
      if (hotkeys.getPreference(currentId).mode === "default") {
        await hotkeys.setPreference(currentId, previous);
      }
      // Compatibility commands have no default bindings. Retiring the old
      // preference avoids duplicate shortcuts and makes migration idempotent.
      await hotkeys.setPreference(previousId, { mode: "default" });
    }
  }
}
