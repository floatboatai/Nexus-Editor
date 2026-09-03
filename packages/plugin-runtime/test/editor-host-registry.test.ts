import type {
  ComponentId,
  EditorId,
  ManagedResource,
  PluginId,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import type {
  EditorAPI,
  EditorAuthoritativeSourceRegistration,
  EditorContributionRegistration,
  EditorContributionSink,
  EditorHistoryController,
  CoreEditorTransactionFilter,
  CoreEditorTransactionHookOptions,
  CoreEditorUpdateListener,
  EditorDomEventHook,
  EditorDomEventHookOptions,
  EditorDomEventType,
  EditorDestroyListener,
  EditorInputTarget,
} from "@floatboat/nexus-core";
import { describe, expect, it, vi } from "vitest";

import {
  EditorContributionCommitError,
  EditorHostRegistry,
} from "../src/editor-host-registry";

interface InstallPlan {
  readonly ready?: Promise<void>;
  readonly dispose?: () => Promise<void>;
  readonly installed?: () => void;
}

function pending(): {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
} {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}

class FakeContributionSink implements EditorContributionSink {
  readonly registrations: Array<{
    readonly registration: EditorContributionRegistration;
    readonly ownerId: string;
    readonly kind: string;
    readonly value: unknown;
  }> = [];
  readonly plans: InstallPlan[] = [];
  private sequence = 0;

  registerExtension(ownerId: string, extension: unknown): EditorContributionRegistration {
    return this.add(ownerId, "extension", extension);
  }

  registerDomEvent<K extends EditorDomEventType>(
    ownerId: string,
    event: K,
    handler: EditorDomEventHook<K>,
    options?: EditorDomEventHookOptions,
  ): EditorContributionRegistration {
    return this.add(ownerId, "dom", { event, handler, options });
  }

  registerInputTarget(
    ownerId: string,
    root: HTMLElement,
    target: Omit<EditorInputTarget, "element">,
  ): EditorContributionRegistration {
    return this.add(ownerId, "target", { root, target });
  }

  registerTransactionFilter(
    ownerId: string,
    filter: CoreEditorTransactionFilter,
    options?: CoreEditorTransactionHookOptions,
  ): EditorContributionRegistration {
    return this.add(ownerId, "transaction-filter", { filter, options });
  }

  registerUpdateListener(
    ownerId: string,
    listener: CoreEditorUpdateListener,
    options?: CoreEditorTransactionHookOptions,
  ): EditorContributionRegistration {
    return this.add(ownerId, "update-listener", { listener, options });
  }

  registerAuthoritativeSource(
    ownerId: string,
    history: EditorHistoryController,
  ): EditorAuthoritativeSourceRegistration {
    const registration = this.add(ownerId, "authoritative-source", history);
    return {
      ...registration,
      get disposed() {
        return registration.disposed;
      },
      dispatch: () => ({ status: "rejected", ownerId, reason: "fake-source" }),
      dispatchTransactions: () => ({ status: "rejected", ownerId, reason: "fake-source" }),
    };
  }

  registerDestroyListener(
    ownerId: string,
    listener: EditorDestroyListener,
  ): EditorContributionRegistration {
    return this.add(ownerId, "destroy-listener", listener);
  }

  isInteractionActive(): boolean {
    return false;
  }

  refresh(): Promise<void> {
    return Promise.resolve();
  }

  private add(
    ownerId: string,
    kind: string,
    value: unknown,
  ): EditorContributionRegistration {
    const plan = this.plans.shift() ?? {};
    let disposed = false;
    let disposePromise: Promise<void> | null = null;
    const registration: EditorContributionRegistration = {
      id: `${kind}:${++this.sequence}`,
      ownerId,
      get disposed() {
        return disposed;
      },
      ready: plan.ready ?? Promise.resolve(),
      dispose: () => {
        if (disposePromise) return disposePromise;
        disposed = true;
        disposePromise = plan.dispose?.() ?? Promise.resolve();
        return disposePromise;
      },
    };
    this.registrations.push({ registration, ownerId, kind, value });
    plan.installed?.();
    return registration;
  }
}

function editorWith(sink: EditorContributionSink): EditorAPI {
  return { getContributionSink: () => sink } as EditorAPI;
}

function owner(plugin = "example.plugin"): ResourceOwner {
  return {
    pluginId: plugin as PluginId,
    componentId: `${plugin}:root` as ComponentId,
  };
}

function attach(
  registry: EditorHostRegistry,
  sink = new FakeContributionSink(),
  editorId?: string,
) {
  const root = document.createElement("div");
  document.body.append(root);
  const attachment = registry.attach({
    editor: editorWith(sink),
    editorId: editorId as EditorId | undefined,
    surface: { kind: "document", root },
  });
  return { attachment, root, sink };
}

describe("EditorHostRegistry", () => {
  it("assigns stable instance ids and preserves nullable per-editor context", async () => {
    const registry = new EditorHostRegistry({ editorIdPrefix: "test-editor" });
    const resources: ManagedResource[] = [];
    const recentChanges: Array<EditorId | null> = [];
    registry.createService(owner(), (resource) => resources.push(resource)).events.on(
      "recentChanged",
      ({ editor }) => recentChanges.push(editor?.editorId ?? null),
    );
    for (const resource of resources) await resource.activate?.();
    const first = attach(registry);
    const second = attach(registry);

    await Promise.all([first.attachment.ready, second.attachment.ready]);

    expect(first.attachment.editorId).toBe("test-editor:1");
    expect(second.attachment.editorId).toBe("test-editor:2");
    expect(first.attachment.context).toMatchObject({
      file: null,
      sourcePath: null,
      view: null,
      leaf: null,
      window: null,
    });
    expect(registry.list()).toHaveLength(2);

    first.attachment.markRecent();
    first.attachment.markRecent();
    second.attachment.markRecent();
    expect(registry.getRecent()?.editorId).toBe(second.attachment.editorId);
    await second.attachment.detach();
    expect(recentChanges).toEqual([
      first.attachment.editorId,
      second.attachment.editorId,
      null,
    ]);
    expect(registry.getRecent()).toBeNull();
    expect(registry.get(second.attachment.editorId)).toBeUndefined();
    expect(first.attachment.editorId).toBe("test-editor:1");
  });

  it("keeps staged contributions invisible, then installs them on current and future editors", async () => {
    const registry = new EditorHostRegistry();
    const current = attach(registry);
    await current.attachment.ready;
    const result = registry.registerEditorExtension(owner(), [], { id: "syntax" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(current.sink.registrations).toHaveLength(0);
    await result.registration.activate();
    expect(current.sink.registrations).toHaveLength(1);
    expect(result.registration.state).toBe("active");

    const future = attach(registry);
    await future.attachment.ready;
    expect(future.sink.registrations).toHaveLength(1);

    await result.registration.dispose();
    expect(current.sink.registrations[0].registration.disposed).toBe(true);
    expect(future.sink.registrations[0].registration.disposed).toBe(true);
    expect(result.registration.disposed).toBe(true);
    await result.registration.dispose();
  });

  it("rolls back already-updated editors in reverse order when a later install fails", async () => {
    const disposalOrder: string[] = [];
    const registry = new EditorHostRegistry();
    const first = attach(registry);
    const second = attach(registry);
    await Promise.all([first.attachment.ready, second.attachment.ready]);
    first.sink.plans.push({ dispose: async () => void disposalOrder.push("first") });
    second.sink.plans.push({
      ready: Promise.reject(new Error("second editor rejected extension")),
      dispose: async () => void disposalOrder.push("second"),
    });

    const result = registry.registerEditorExtension(owner(), [], { id: "atomic" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(result.registration.activate()).rejects.toBeInstanceOf(
      EditorContributionCommitError,
    );
    expect(disposalOrder).toEqual(["second", "first"]);
    expect(result.registration.state).not.toBe("active");

    const future = attach(registry);
    await future.attachment.ready;
    expect(future.sink.registrations).toHaveLength(0);
    await result.registration.dispose();
  });

  it("treats detach while an installation is pending as a skipped editor", async () => {
    const registry = new EditorHostRegistry();
    const first = attach(registry);
    const second = attach(registry);
    await Promise.all([first.attachment.ready, second.attachment.ready]);
    const waiting = pending();
    const installed = pending();
    second.sink.plans.push({ ready: waiting.promise, installed: installed.resolve });

    const result = registry.registerEditorExtension(owner(), [], { id: "detach-race" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const activation = result.registration.activate();
    await installed.promise;
    await second.attachment.detach();

    await expect(activation).resolves.toBeUndefined();
    expect(result.registration.state).toBe("active");
    expect(second.sink.registrations[0].registration.disposed).toBe(true);
    expect(first.sink.registrations[0].registration.disposed).toBe(false);
    waiting.resolve();
    await result.registration.dispose();
  });

  it("isolates an editor and emits a fatal diagnostic when rollback itself fails", async () => {
    const diagnostics: Array<{ severity: string; message: string }> = [];
    const registry = new EditorHostRegistry({
      reportDiagnostic: (item) => diagnostics.push(item),
    });
    const first = attach(registry);
    const second = attach(registry);
    await Promise.all([first.attachment.ready, second.attachment.ready]);
    first.sink.plans.push({
      dispose: () => Promise.reject(new Error("rollback failed")),
    });
    second.sink.plans.push({
      ready: Promise.reject(new Error("install failed")),
    });
    const result = registry.registerEditorExtension(owner(), [], { id: "isolation" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(result.registration.activate()).rejects.toMatchObject({
      rollbackErrors: [expect.any(Error)],
    });
    expect(registry.get(first.attachment.editorId)).toBeUndefined();
    expect(registry.get(second.attachment.editorId)).toBeDefined();
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: "fatal", message: expect.stringContaining("isolated") }),
    );
    await result.registration.dispose();
  });

  it("uses owner-bound staged subscriptions and isolates callback failures", async () => {
    const diagnostics: Array<{ code: string }> = [];
    const registry = new EditorHostRegistry({
      reportDiagnostic: (item) => diagnostics.push(item),
    });
    const resources: Array<{ activate?: () => void | Promise<void> }> = [];
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    const seen: string[] = [];
    service.events.on("attached", () => {
      seen.push("first");
      throw new Error("listener failed");
    });
    service.events.on("attached", (context) => seen.push(String(context.editorId)));

    const beforeCommit = attach(registry);
    await beforeCommit.attachment.ready;
    expect(seen).toEqual([]);
    for (const resource of resources) await resource.activate?.();

    const afterCommit = attach(registry, new FakeContributionSink(), "event-editor");
    await afterCommit.attachment.ready;
    expect(seen).toEqual(["first", "event-editor"]);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "callback-failed" }));
  });

  it("rejects a reused explicit editor id even after detach", async () => {
    const registry = new EditorHostRegistry();
    const first = attach(registry, new FakeContributionSink(), "stable-id");
    await first.attachment.ready;
    await first.attachment.detach();

    expect(() => attach(registry, new FakeContributionSink(), "stable-id")).toThrow(
      "has already been used",
    );
  });

  it("atomically re-evaluates matches and refreshes callback context on context changes", async () => {
    const registry = new EditorHostRegistry();
    const current = attach(registry);
    await current.attachment.ready;
    const resources: Array<{ activate?: () => void | Promise<void> }> = [];
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    const seen: Array<string | null> = [];
    const registered = service.registerDomEvent(
      "paste",
      (_event, context) => {
        seen.push(context.sourcePath);
      },
      { matches: (context) => context.sourcePath !== null },
    );
    expect(registered.ok).toBe(true);
    await resources[0]?.activate?.();
    expect(current.sink.registrations).toHaveLength(0);

    await current.attachment.updateContext({ sourcePath: "Notes/one.md" as never });
    expect(current.sink.registrations).toHaveLength(1);
    const first = current.sink.registrations[0]!.value as {
      handler: (event: ClipboardEvent, context: unknown) => void;
    };
    first.handler(new Event("paste") as ClipboardEvent, {});
    expect(seen).toEqual(["Notes/one.md"]);

    await current.attachment.updateContext({ sourcePath: "Notes/two.md" as never });
    expect(current.sink.registrations).toHaveLength(2);
    expect(current.sink.registrations[0]!.registration.disposed).toBe(true);
    const second = current.sink.registrations[1]!.value as {
      handler: (event: ClipboardEvent, context: unknown) => void;
    };
    second.handler(new Event("paste") as ClipboardEvent, {});
    expect(seen).toEqual(["Notes/one.md", "Notes/two.md"]);

    await current.attachment.updateContext({ sourcePath: null });
    expect(current.sink.registrations[1]!.registration.disposed).toBe(true);
  });
});
