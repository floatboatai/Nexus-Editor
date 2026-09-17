import { createEditor } from "@floatboat/nexus-core";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
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
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BlockDragLifecyclePlugin,
  blockDragLifecyclePluginManifest,
} from "../src/runtime-plugin";

const cleanups: (() => void | Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  document.body.replaceChildren();
});

function createHost() {
  const capabilities = new RuntimeCapabilityRegistry();
  const commands = new CommandRegistry();
  const editors = new EditorHostRegistry();
  const hotkeys = new HotkeyRegistry(commands, { platform: "linux" });
  capabilities.registerOwnerBound(COMMANDS_CAPABILITY, ({ owner, registerResource }) =>
    commands.createService(owner, registerResource));
  capabilities.registerOwnerBound(EDITOR_HOST_CAPABILITY, ({ owner, registerResource }) =>
    editors.createService(owner, registerResource));

  async function attach(initialValue = "first\n\nsecond", readOnly = false) {
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({
      container,
      initialValue,
      readOnly,
      parseDelayMs: 0,
      plugins: [createHistoryPlugin()],
    });
    const attachment = editors.attach({
      editor,
      surface: { kind: "document", root: container },
    });
    await attachment.ready;
    cleanups.push(async () => {
      await attachment.detach();
      editor.destroy();
      container.remove();
    });
    return { editor, attachment, container };
  }

  async function enable() {
    const result = normalizeAuthorManifest(blockDragLifecyclePluginManifest, {
      source: { kind: "development", locator: "fixture:block-drag" },
    });
    if (!result.ok) throw new Error("Invalid block-drag manifest");
    const access = capabilities.createPluginAccess(result.manifest);
    const app: NexusApp = {
      apiVersion: "1.0.0",
      host: { id: "block-drag-test", name: "Block Drag Test", version: "1.0.0", platform: "web" },
      capabilities: access,
      diagnostics: new DiagnosticBus(),
    };
    const plugin = new BlockDragLifecyclePlugin(app, result.manifest);
    const controller = new ComponentLifecycleRuntime().manage(plugin, result.manifest.identity);
    access.bindOwner(plugin);
    await controller.load();
    let disabled = false;
    const disable = async () => {
      if (disabled) return;
      disabled = true;
      expect((await controller.unload()).clean).toBe(true);
      await access.dispose();
    };
    cleanups.push(disable);
    return { plugin, disable };
  }

  return { commands, editors, hotkeys, attach, enable };
}

function content(container: HTMLElement): HTMLElement {
  const element = container.querySelector<HTMLElement>(".cm-content");
  if (!element) throw new Error("Missing editor content");
  return element;
}

function key(value = "ArrowDown", init: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", {
    key: value,
    altKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
    ...init,
  });
}

describe("BlockDragLifecyclePlugin", () => {
  it("routes commands to their editor, including editors attached after enable", async () => {
    const host = createHost();
    const first = await host.attach();
    await host.enable();
    const second = await host.attach("alpha\n\nbeta");

    expect(await host.commands.checkCommand("block-drag:move-down", {
      editor: second.attachment.context,
    })).toEqual({ status: "available" });
    expect(second.editor.getDocument()).toBe("alpha\n\nbeta");
    expect((await host.commands.executeCommand("block-drag:move-down", {
      editor: second.attachment.context,
    })).ok).toBe(true);
    expect(second.editor.getDocument()).toBe("beta\n\nalpha");
    expect(first.editor.getDocument()).toBe("first\n\nsecond");
    expect(second.editor.undo()).toBe(true);
    expect(second.editor.getDocument()).toBe("alpha\n\nbeta");
  });

  it("disables commands at document boundaries and in read-only editors", async () => {
    const host = createHost();
    const first = await host.attach();
    const readOnly = await host.attach(undefined, true);
    await host.enable();
    expect(await host.commands.checkCommand("block-drag:move-up", {
      editor: first.attachment.context,
    })).toMatchObject({ status: "unavailable" });
    expect(await host.commands.checkCommand("block-drag:move-down", {
      editor: readOnly.attachment.context,
    })).toMatchObject({ status: "unavailable" });
    expect(await host.commands.checkCommand("block-drag:move-down")).toEqual({ status: "no-editor" });
  });

  it("honors rebinding and clearing without leaving a fixed editor keymap", async () => {
    const host = createHost();
    const fixture = await host.attach();
    await host.enable();
    const context = { editor: fixture.attachment.context };
    const down = "block-drag:move-down";
    const original = host.hotkeys.dispatchKeyboardEvent(key(), context);
    expect(original.status).toBe("handled");
    if (original.status === "handled") expect((await original.completion).ok).toBe(true);
    expect(fixture.editor.getDocument()).toBe("second\n\nfirst");
    fixture.editor.undo();

    await host.hotkeys.setPreference(down, {
      mode: "custom",
      bindings: [{ key: "j", modifiers: ["Alt"] }],
    });
    expect(host.hotkeys.dispatchKeyboardEvent(key(), context).status).toBe("pass");
    const rebound = host.hotkeys.dispatchKeyboardEvent(key("j", { shiftKey: false }), context);
    expect(rebound.status).toBe("handled");
    if (rebound.status === "handled") expect((await rebound.completion).ok).toBe(true);
    fixture.editor.undo();

    await host.hotkeys.setPreference(down, { mode: "cleared" });
    expect(host.hotkeys.dispatchKeyboardEvent(key("j", { shiftKey: false }), context).status).toBe("pass");
    const event = key();
    content(fixture.container).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(fixture.editor.getDocument()).toBe("first\n\nsecond");
  });

  it("leaves conflicting shortcuts to the host conflict policy", async () => {
    const host = createHost();
    const fixture = await host.attach();
    await host.enable();
    const resources: ManagedResource[] = [];
    const action = vi.fn();
    const owner = { pluginId: "another-plugin", componentId: "another-plugin/root" } as ResourceOwner;
    host.commands.createService(owner, (resource) => resources.push(resource)).registerCommand({
      id: "move",
      name: "Other movement",
      callback: action,
      defaultHotkeys: [{ key: "ArrowDown", modifiers: ["Alt", "Shift"] }],
    });
    for (const resource of resources) await resource.activate?.();
    cleanups.push(async () => {
      for (const resource of resources) await resource.dispose();
    });

    const event = key();
    expect(host.hotkeys.dispatchKeyboardEvent(event, {
      editor: fixture.attachment.context,
    }).status).toBe("conflict");
    content(fixture.container).dispatchEvent(event);
    expect(fixture.editor.getDocument()).toBe("first\n\nsecond");
    expect(action).not.toHaveBeenCalled();
  });

  it("removes commands on disable and preserves hotkey preferences after re-enable", async () => {
    const host = createHost();
    const fixture = await host.attach();
    const first = await host.enable();
    expect(fixture.container.querySelectorAll(".nexus-block-drag")).toHaveLength(1);
    await host.hotkeys.setPreference("block-drag:move-down", { mode: "cleared" });
    await first.disable();
    expect(fixture.container.querySelectorAll(".nexus-block-drag")).toHaveLength(0);
    expect(host.commands.listCommands()).toEqual([]);
    expect(host.hotkeys.dispatchKeyboardEvent(key()).status).toBe("pass");
    await host.enable();
    expect(fixture.container.querySelectorAll(".nexus-block-drag")).toHaveLength(1);
    expect(host.commands.listCommands()).toHaveLength(2);
    expect(host.hotkeys.getBindings("block-drag:move-down")).toEqual([]);
    expect((await host.commands.executeCommand("block-drag:move-down", {
      editor: fixture.attachment.context,
    })).ok).toBe(true);
    expect(fixture.editor.getDocument()).toBe("second\n\nfirst");
  });

  it("does not retain an editor after detach", async () => {
    const host = createHost();
    const fixture = await host.attach();
    await host.enable();
    const context = fixture.attachment.context;
    await fixture.attachment.detach();
    expect(await host.commands.checkCommand("block-drag:move-down", {
      editor: context,
    })).toMatchObject({ status: "unavailable" });
    expect(fixture.editor.getDocument()).toBe("first\n\nsecond");
  });
});
