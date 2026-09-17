import type {
  CommandContext,
  ComponentId,
  HotkeyBinding,
  ManagedResource,
  NexusDiagnostic,
  PluginId,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../src/commands/command-registry";
import {
  HotkeyRegistry,
  MemoryHotkeyPreferenceStore,
} from "../src/commands/hotkey-registry";
import {
  hotkeyToString,
  keyboardEventToHotkey,
} from "../src/commands/hotkey-normalization";
import { ScopeRegistry } from "../src/commands/scope-registry";

function owner(pluginId = "sample-tools"): ResourceOwner {
  return {
    pluginId: pluginId as PluginId,
    componentId: `${pluginId}/root` as ComponentId,
  };
}

function key(
  value: string,
  init: Omit<KeyboardEventInit, "key"> = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: value, cancelable: true, ...init });
}

function activate(resources: readonly ManagedResource[]): void {
  for (const resource of resources) resource.activate?.();
}

const commandContext: CommandContext = { trigger: "hotkey", editor: null };

describe("HotkeyRegistry", () => {
  it("normalizes Mod and key aliases consistently across platforms", () => {
    expect(hotkeyToString({ key: "V", modifiers: ["Mod"] }, "macos")).toBe("Meta+v");
    expect(hotkeyToString({ key: "V", modifiers: ["Mod"] }, "windows")).toBe("Ctrl+v");
    expect(keyboardEventToHotkey(key("Esc"), "linux")).toBe("escape");
    expect(keyboardEventToHotkey(key("V", { ctrlKey: true }), "windows")).toBe(
      "Ctrl+v",
    );
  });

  it("persists custom, cleared and restored preferences across command reload", async () => {
    const commandResources: ManagedResource[] = [];
    const commands = new CommandRegistry();
    const service = commands.createService(owner(), (resource) =>
      commandResources.push(resource),
    );
    const first = service.registerCommand({
      id: "paste-special",
      name: "Paste special",
      callback: vi.fn(),
      defaultHotkeys: [{ key: "V", modifiers: ["Mod", "Shift"] }],
    });
    activate(commandResources);
    const store = new MemoryHotkeyPreferenceStore();
    const hotkeys = new HotkeyRegistry(commands, {
      platform: "windows",
      preferences: store,
    });
    expect(hotkeys.getBindings("sample-tools:paste-special")).toEqual([
      { key: "v", modifiers: ["Mod", "Shift"] },
    ]);

    await hotkeys.setPreference("sample-tools:paste-special", {
      mode: "custom",
      bindings: [{ key: "P", modifiers: ["Ctrl", "Alt"] }],
    });
    expect(hotkeys.getBindings("sample-tools:paste-special")).toEqual([
      { key: "p", modifiers: ["Ctrl", "Alt"] },
    ]);
    await hotkeys.setPreference("sample-tools:paste-special", { mode: "cleared" });
    expect(hotkeys.getBindings("sample-tools:paste-special")).toEqual([]);

    if (first.ok) await first.registration.dispose();
    const reloaded = service.registerCommand({
      id: "paste-special",
      name: "Paste special v2",
      callback: vi.fn(),
      defaultHotkeys: [{ key: "X", modifiers: ["Mod"] }],
    });
    expect(reloaded.ok).toBe(true);
    commandResources.at(-1)?.activate?.();
    expect(hotkeys.getBindings("sample-tools:paste-special")).toEqual([]);
    await hotkeys.setPreference("sample-tools:paste-special", { mode: "default" });
    expect(hotkeys.getBindings("sample-tools:paste-special")).toEqual([
      { key: "x", modifiers: ["Mod"] },
    ]);
  });

  it.each(["default", "custom"] as const)(
    "resolves %s bindings per platform without changing their stored semantics",
    async (mode) => {
      const resources: ManagedResource[] = [];
      const action = vi.fn();
      const reportDiagnostic = vi.fn();
      const commands = new CommandRegistry();
      const service = commands.createService(owner(), (resource) => resources.push(resource));
      const bindings: readonly HotkeyBinding[] = [
        { key: "k", modifiers: ["Mod"] },
        { key: "k", modifiers: ["Ctrl"] },
        { key: "k", modifiers: ["Meta"] },
      ];
      service.registerCommand({
        id: "run",
        name: "Run",
        callback: action,
        defaultHotkeys: mode === "default" ? bindings : [],
      });
      activate(resources);
      const preferences = new MemoryHotkeyPreferenceStore();
      if (mode === "custom") {
        await new HotkeyRegistry(commands, { platform: "windows", preferences })
          .setPreference("sample-tools:run", { mode, bindings });
      }

      for (const platform of ["windows", "linux", "macos"] as const) {
        const hotkeys = new HotkeyRegistry(commands, { platform, preferences, reportDiagnostic });
        expect(hotkeys.findConflicts()).toEqual([]);
        for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
          const event = key("k", modifiers);
          const dispatched = hotkeys.dispatchKeyboardEvent(event);
          expect(dispatched).toMatchObject({ status: "handled", commandId: "sample-tools:run" });
          expect(event.defaultPrevented).toBe(true);
          if (dispatched.status === "handled") await dispatched.completion;
          expect(action).toHaveBeenCalledTimes(1);
          action.mockClear();
        }
        expect(hotkeys.getBindings("sample-tools:run")).toEqual(bindings);
        expect(hotkeys.getPreference("sample-tools:run")).toEqual(
          mode === "custom" ? { mode, bindings } : { mode },
        );
      }
      expect(reportDiagnostic).not.toHaveBeenCalled();
    },
  );

  it.each(["windows", "linux", "macos"] as const)(
    "diagnoses distinct command conflicts after resolving aliases on %s",
    (platform) => {
      const resources: ManagedResource[] = [];
      const diagnostics: NexusDiagnostic[] = [];
      const action = vi.fn();
      const commands = new CommandRegistry();
      const modifier = platform === "macos" ? "Meta" : "Ctrl";
      const first = commands.createService(owner("first"), (resource) => resources.push(resource));
      const second = commands.createService(owner("second"), (resource) => resources.push(resource));
      first.registerCommand({
        id: "one",
        name: "One",
        callback: action,
        defaultHotkeys: [
          { key: "K", modifiers: ["Mod"] },
          { key: "K", modifiers: [modifier] },
        ],
      });
      second.registerCommand({
        id: "two",
        name: "Two",
        callback: action,
        defaultHotkeys: [{ key: "k", modifiers: [modifier] }],
      });
      activate(resources);
      const hotkeys = new HotkeyRegistry(commands, {
        platform,
        reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      });

      expect(hotkeys.findConflicts()).toMatchObject([
        {
          scopeId: "application",
          normalizedHotkey: `${modifier}+k`,
          commandIds: ["first:one", "second:two"],
        },
      ]);
      const event = key("k", { ctrlKey: platform !== "macos", metaKey: platform === "macos" });
      expect(hotkeys.dispatchKeyboardEvent(event)).toMatchObject({
        status: "conflict",
        conflict: { commandIds: ["first:one", "second:two"] },
      });
      expect(event.defaultPrevented).toBe(false);
      expect(action).not.toHaveBeenCalled();
      expect(diagnostics).toHaveLength(1);
    },
  );

  it("synchronously consumes a unique command hotkey without fabricating clipboard events", async () => {
    const resources: ManagedResource[] = [];
    const action = vi.fn();
    const commands = new CommandRegistry();
    const service = commands.createService(owner(), (resource) => resources.push(resource));
    service.registerCommand({
      id: "semantic-paste",
      name: "Semantic paste",
      callback: action,
      defaultHotkeys: [{ key: "V", modifiers: ["Mod"] }],
    });
    activate(resources);
    const hotkeys = new HotkeyRegistry(commands, { platform: "windows" });
    const event = key("v", { ctrlKey: true });
    const dispatched = hotkeys.dispatchKeyboardEvent(event);

    expect(dispatched.status).toBe("handled");
    expect(event.defaultPrevented).toBe(true);
    if (dispatched.status === "handled") await dispatched.completion;
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "hotkey", sourceId: "Ctrl+v" }),
    );
  });
});

describe("ScopeRegistry", () => {
  it("walks top scope through parents and application, then auto-pops on quiesce", () => {
    const resources: ManagedResource[] = [];
    const registry = new ScopeRegistry({ platform: "windows" });
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    const parent = service.createScope("view");
    const modal = service.createScope("modal", parent);
    const calls: string[] = [];
    service.applicationScope.registerHotkey({ key: "K" }, () => {
      calls.push("application");
      return "handled";
    });
    parent.registerHotkey({ key: "K" }, () => {
      calls.push("parent");
      return "handled";
    });
    modal.registerHotkey({ key: "K" }, () => {
      calls.push("modal-pass");
      return "pass";
    });
    const pushed = service.pushScope(modal);
    activate(resources);

    const first = key("k");
    expect(registry.dispatchKeyboardEvent(first, commandContext)).toMatchObject({
      status: "handled",
      scopeId: "sample-tools:view",
    });
    expect(calls).toEqual(["modal-pass", "parent"]);
    expect(first.defaultPrevented).toBe(true);
    expect(service.activeScopes.map((scope) => scope.id)).toEqual([
      "sample-tools:modal",
      "application",
    ]);

    void pushed.dispose();
    calls.length = 0;
    const second = key("k");
    registry.dispatchKeyboardEvent(second, commandContext);
    expect(calls).toEqual(["application"]);
  });

  it("reports same-priority conflicts without invoking either handler", () => {
    const resources: ManagedResource[] = [];
    const diagnostics: NexusDiagnostic[] = [];
    const registry = new ScopeRegistry({
      platform: "linux",
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    const handler = vi.fn(() => "handled" as const);
    service.applicationScope.registerHotkey({ key: "A" }, handler);
    service.applicationScope.registerHotkey({ key: "a" }, handler);
    activate(resources);

    expect(registry.dispatchKeyboardEvent(key("a"), commandContext)).toMatchObject({
      status: "conflict",
      diagnostic: { code: "command-conflict" },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(diagnostics).toHaveLength(1);
  });

  it("treats a throwing selected handler as consumed and keeps the stack usable", () => {
    const resources: ManagedResource[] = [];
    const diagnostics: NexusDiagnostic[] = [];
    const registry = new ScopeRegistry({
      platform: "macos",
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    const lower = vi.fn(() => "handled" as const);
    service.applicationScope.registerHotkey({ key: "X", modifiers: ["Mod"] }, lower);
    const modal = service.createScope("modal");
    modal.registerHotkey({ key: "x", modifiers: ["Meta"] }, () => {
      throw new Error("partial side effect");
    });
    service.pushScope(modal);
    activate(resources);

    const event = key("x", { metaKey: true });
    expect(registry.dispatchKeyboardEvent(event, commandContext).status).toBe("handled");
    expect(event.defaultPrevented).toBe(true);
    expect(lower).not.toHaveBeenCalled();
    expect(diagnostics).toMatchObject([{ code: "callback-failed" }]);
    expect(registry.dispatchKeyboardEvent(key("z"), commandContext).status).toBe("pass");
  });
});
