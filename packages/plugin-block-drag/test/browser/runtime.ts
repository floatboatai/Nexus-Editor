import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  type HotkeyPreference,
  type ManagedResource,
  type NexusApp,
  type ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import {
  CommandRegistry,
  ComponentLifecycleRuntime,
  DiagnosticBus,
  EditorHostRegistry,
  HotkeyRegistry,
  RuntimeCapabilityRegistry,
  normalizeAuthorManifest,
} from "@floatboat/nexus-plugin-runtime";

import {
  BlockDragLifecyclePlugin,
  blockDragLifecyclePluginManifest,
} from "../../src/runtime-plugin";

const capabilities = new RuntimeCapabilityRegistry();
const commands = new CommandRegistry();
const editors = new EditorHostRegistry();
const hotkeys = new HotkeyRegistry(commands, { platform: "macos" });
capabilities.registerOwnerBound(COMMANDS_CAPABILITY, ({ owner, registerResource }) =>
  commands.createService(owner, registerResource));
capabilities.registerOwnerBound(EDITOR_HOST_CAPABILITY, ({ owner, registerResource }) =>
  editors.createService(owner, registerResource));

async function attach(id: string, source: string) {
  const container = document.getElementById(id)!;
  const editor = createEditor({
    container,
    initialValue: source,
    parseDelayMs: 0,
    plugins: [createHistoryPlugin()],
  });
  const attachment = editors.attach({
    editor,
    surface: { kind: "document", root: container },
  });
  await attachment.ready;
  return { editor, attachment, container };
}

let disable: (() => Promise<void>) | null = null;
async function enable(): Promise<void> {
  if (disable) return;
  const result = normalizeAuthorManifest(blockDragLifecyclePluginManifest, {
    source: { kind: "development", locator: "fixture:block-drag-browser" },
  });
  if (!result.ok) throw new Error("Invalid block-drag manifest");
  const access = capabilities.createPluginAccess(result.manifest);
  const app: NexusApp = {
    apiVersion: "1.0.0",
    host: { id: "block-drag-browser", name: "Browser acceptance", version: "1.0.0", platform: "web" },
    capabilities: access,
    diagnostics: new DiagnosticBus(),
  };
  const plugin = new BlockDragLifecyclePlugin(app, result.manifest);
  const controller = new ComponentLifecycleRuntime().manage(plugin, result.manifest.identity);
  access.bindOwner(plugin);
  await controller.load();
  disable = async () => {
    const result = await controller.unload();
    await access.dispose();
    if (!result.clean) throw new Error("Block-drag unload was not clean");
    disable = null;
  };
}

const first = await attach("first", "First\n\nSecond\n\nThird");
await enable();
// A late attachment must receive the already active runtime extension.
const second = await attach("second", "Alpha\n\nBeta\n\nGamma");
const fixtures = { first, second };
let lastDispatch: { status: string; commandId?: string; ok?: boolean } | null = null;
let completion: Promise<void> = Promise.resolve();

// Mirror the application's capture-phase command routing, deriving this fixture's
// active editor from the actual focused DOM surface rather than a supplied ID.
document.addEventListener("keydown", event => {
  if (event.defaultPrevented || ["Alt", "Control", "Meta", "Shift"].includes(event.key)) return;
  const active = Object.values(fixtures).find(fixture =>
    fixture.container.contains(document.activeElement));
  const result = hotkeys.dispatchKeyboardEvent(event, {
    trigger: "hotkey",
    editor: active?.attachment.context ?? null,
  });
  lastDispatch = { status: result.status };
  if (result.status === "handled") {
    const dispatch = lastDispatch;
    dispatch.commandId = result.commandId;
    completion = result.completion.then(result => { dispatch.ok = result.ok; });
  } else {
    completion = Promise.resolve();
  }
}, true);

const conflictResources: ManagedResource[] = [];
let conflictingCalls = 0;
async function conflict(enabled: boolean): Promise<void> {
  for (const resource of conflictResources.splice(0)) await resource.dispose();
  if (!enabled) return;
  const owner = { pluginId: "acceptance-conflict", componentId: "acceptance-conflict/root" } as ResourceOwner;
  const result = commands.createService(owner, resource => conflictResources.push(resource)).registerCommand({
    id: "move",
    name: "Conflicting block movement",
    callback: () => { conflictingCalls++; },
    defaultHotkeys: [{ key: "ArrowDown", modifiers: ["Alt", "Shift"] }],
  });
  if (!result.ok) throw new Error("Could not register conflict fixture");
  for (const resource of conflictResources) await resource.activate?.();
}

Object.assign(window, {
  runtimeFixture: {
    async settled() { await completion; },
    snapshot() {
      return {
        documents: { first: first.editor.getDocument(), second: second.editor.getDocument() },
        overlays: document.querySelectorAll(".nexus-block-drag").length,
        commands: commands.listCommands().map(command => command.id),
        lastDispatch,
        conflictingCalls,
      };
    },
    preference(preference: HotkeyPreference) {
      return hotkeys.setPreference("block-drag:move-down", preference);
    },
    conflict,
    enable,
    async disable() { await disable?.(); },
  },
});
