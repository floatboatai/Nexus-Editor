import type {
  ComponentId,
  EditorContext,
  ManagedResource,
  NexusDiagnostic,
  PluginId,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../src/commands/command-registry";

function owner(pluginId = "sample-tools"): ResourceOwner {
  return {
    pluginId: pluginId as PluginId,
    componentId: `${pluginId}/root` as ComponentId,
  };
}

function activate(resources: readonly ManagedResource[]): void {
  for (const resource of resources) resource.activate?.();
}

describe("CommandRegistry", () => {
  it("cancels an invocation while its editor context is resolving", async () => {
    let finishResolution!: () => void;
    const pendingContext = new Promise<void>((resolve) => { finishResolution = resolve; });
    const callback = vi.fn();
    const registry = new CommandRegistry({
      resolveContext: async () => {
        await pendingContext;
        return { trigger: "ui", editor: null };
      },
    });
    const registered = registry.registerCommand(owner(), { id: "pending", name: "Pending", callback });
    if (!registered.ok) throw new Error("Fixture command failed to register");
    registered.registration.activate?.();
    const controller = new AbortController();
    const context = { trigger: "ui" as const, signal: controller.signal };
    const completion = registry.executeCommand("sample-tools:pending", context);
    controller.abort();
    finishResolution();

    expect(await completion).toMatchObject({ ok: false, diagnostic: { code: "command-unavailable" } });
    expect(callback).not.toHaveBeenCalled();
  });

  it("does not invoke a registration removed during context resolution", async () => {
    let finishResolution!: () => void;
    const pendingContext = new Promise<void>((resolve) => { finishResolution = resolve; });
    const callback = vi.fn();
    const registry = new CommandRegistry({
      resolveContext: async () => {
        await pendingContext;
        return { trigger: "api", editor: null };
      },
    });
    const registered = registry.registerCommand(owner(), { id: "pending", name: "Pending", callback });
    if (!registered.ok) throw new Error("Fixture command failed to register");
    registered.registration.activate?.();
    const completion = registry.executeCommand("sample-tools:pending");
    await registered.registration.dispose();
    finishResolution();

    expect(await completion).toMatchObject({ ok: false, diagnostic: { code: "command-unavailable" } });
    expect(callback).not.toHaveBeenCalled();
  });

  it("preserves a live caller signal even when the host resolves only editor context", async () => {
    const callback = vi.fn();
    const registry = new CommandRegistry({
      resolveContext: () => ({ trigger: "api", editor: null }),
    });
    const registered = registry.registerCommand(owner(), { id: "signal", name: "Signal", callback });
    if (!registered.ok) throw new Error("Fixture command failed to register");
    registered.registration.activate?.();
    const context = { trigger: "api" as const, signal: new AbortController().signal };

    expect((await registry.executeCommand("sample-tools:signal", context)).ok).toBe(true);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ signal: context.signal }));
  });

  it("publishes one atomic namespaced snapshot and preserves other plugins", async () => {
    const resources: ManagedResource[] = [];
    const registry = new CommandRegistry();
    const first = registry.createService(owner(), (resource) => resources.push(resource));
    const second = registry.createService(owner("other-plugin"), (resource) =>
      resources.push(resource),
    );
    const callback = vi.fn();

    const registered = first.registerCommand({
      id: "format-selection",
      name: "Format selection",
      callback,
      defaultHotkeys: [{ key: "F", modifiers: ["Mod", "Shift"] }],
    });
    expect(registered.ok).toBe(true);
    expect(first.getCommand("sample-tools:format-selection")).toBeUndefined();
    expect(first.listCommands()).toEqual([]);

    const duplicate = first.registerCommand({
      id: "format-selection",
      name: "Duplicate",
      callback: vi.fn(),
    });
    expect(duplicate).toMatchObject({
      ok: false,
      diagnostic: { code: "command-conflict" },
    });
    expect(
      second.registerCommand({
        id: "format-selection",
        name: "Other plugin command",
        callback: vi.fn(),
      }).ok,
    ).toBe(true);

    activate(resources);
    expect(first.listCommands().map((command) => command.id)).toEqual([
      "sample-tools:format-selection",
      "other-plugin:format-selection",
    ]);
    expect(registry.listHotkeyCandidates()[0]).toMatchObject({
      id: "sample-tools:format-selection",
      defaultHotkeys: [{ key: "f", modifiers: ["Mod", "Shift"] }],
    });
    await first.executeCommand("sample-tools:format-selection");
    expect(callback).toHaveBeenCalledOnce();

    const firstRegistration = resources[0]!;
    firstRegistration.quiesce?.();
    expect(first.getCommand("sample-tools:format-selection")).toBeUndefined();
    expect(first.listCommands().map((command) => command.id)).toEqual([
      "other-plugin:format-selection",
    ]);
    await firstRegistration.dispose();
    await firstRegistration.dispose();
  });

  it("rejects definitions with zero or multiple execution modes before publication", () => {
    const diagnostics: NexusDiagnostic[] = [];
    const registry = new CommandRegistry({
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    const noMode = registry.registerCommand(
      owner(),
      { id: "empty", name: "Empty" } as never,
    );
    const multipleModes = registry.registerCommand(
      owner(),
      {
        id: "ambiguous",
        name: "Ambiguous",
        callback: vi.fn(),
        editorCallback: vi.fn(),
      } as never,
    );

    expect(noMode).toMatchObject({ ok: false, diagnostic: { code: "command-invalid" } });
    expect(multipleModes).toMatchObject({
      ok: false,
      diagnostic: { code: "command-invalid" },
    });
    expect(registry.listCommands()).toEqual([]);
    expect(diagnostics).toHaveLength(2);
  });

  it("probes without action and revalidates changed state at execution", async () => {
    let available = true;
    const checks: boolean[] = [];
    let actions = 0;
    const resources: ManagedResource[] = [];
    const registry = new CommandRegistry();
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    service.registerCommand({
      id: "conditional",
      name: "Conditional",
      checkCallback: (checking) => {
        checks.push(checking);
        if (!checking && available) actions += 1;
        return available;
      },
    });
    activate(resources);

    await expect(service.checkCommand("sample-tools:conditional")).resolves.toEqual({
      status: "available",
    });
    expect(actions).toBe(0);
    available = false;
    await expect(service.executeCommand("sample-tools:conditional")).resolves.toMatchObject({
      ok: false,
      diagnostic: { code: "command-unavailable" },
    });
    expect(checks).toEqual([true, false]);
    expect(actions).toBe(0);
  });

  it("resolves editor context for every probe and trigger and handles no editor", async () => {
    const firstEditor = { editorId: "first" } as unknown as EditorContext;
    const secondEditor = { editorId: "second" } as unknown as EditorContext;
    let current: EditorContext | null = firstEditor;
    let resolutions = 0;
    const received: EditorContext[] = [];
    const resources: ManagedResource[] = [];
    const registry = new CommandRegistry({
      resolveContext: (partial) => {
        resolutions += 1;
        return {
          trigger: partial.trigger ?? "api",
          editor: current,
        };
      },
    });
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    service.registerCommand({
      id: "editor-command",
      name: "Editor command",
      editorCallback: (editor) => void received.push(editor),
    });
    activate(resources);

    expect(await service.checkCommand("sample-tools:editor-command")).toEqual({
      status: "available",
    });
    current = secondEditor;
    expect((await service.executeCommand("sample-tools:editor-command")).ok).toBe(true);
    expect(received).toEqual([secondEditor]);
    current = null;
    expect(await service.checkCommand("sample-tools:editor-command")).toEqual({
      status: "no-editor",
    });
    expect((await service.executeCommand("sample-tools:editor-command")).ok).toBe(false);
    expect(received).toEqual([secondEditor]);
    expect(resolutions).toBe(4);
  });

  it("isolates probe and command callback failures", async () => {
    const diagnostics: NexusDiagnostic[] = [];
    const resources: ManagedResource[] = [];
    const registry = new CommandRegistry({
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    service.registerCommand({
      id: "broken-probe",
      name: "Broken probe",
      checkCallback: () => {
        throw new Error("probe secret");
      },
    });
    service.registerCommand({
      id: "broken-action",
      name: "Broken action",
      callback: async () => {
        throw new Error("action failed");
      },
    });
    service.registerCommand({ id: "healthy", name: "Healthy", callback: vi.fn() });
    activate(resources);

    expect(await service.checkCommand("sample-tools:broken-probe")).toMatchObject({
      status: "unavailable",
      diagnostic: { code: "callback-failed" },
    });
    expect(await service.executeCommand("sample-tools:broken-action")).toMatchObject({
      ok: false,
      diagnostic: { code: "callback-failed" },
    });
    expect(service.getCommand("sample-tools:healthy")).toBeDefined();
    expect(diagnostics.map((item) => item.resourceId)).toEqual([
      "sample-tools:broken-probe",
      "sample-tools:broken-action",
    ]);
  });
});
