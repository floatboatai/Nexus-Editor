import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it, vi } from "vitest";

import {
  CollaborationError,
  asDocumentId,
  createCollaborationEngine,
  type CollaborativeDocumentHandle,
} from "../src";
import {
  createAssessmentMemoryStore,
  createAssessmentProviderHub,
} from "../src/assessment";

const ref = (value = "018f1f42-4bea-7a11-b6aa-9e922f009701") => ({
  id: asDocumentId(value),
  hostIdentity: "assessment-vault",
  sourcePath: "notes/shared.md",
});

function editor(initialValue = "") {
  const container = document.createElement("div");
  document.body.append(container);
  const instance = createEditor({ container, initialValue });
  return { editor: instance, container };
}

async function closeAll(...resources: Array<{ close(): Promise<void> }>): Promise<void> {
  for (const resource of resources.reverse()) await resource.close();
}

describe("CollaborationEngine", () => {
  it("keeps create and open distinct and validates stable identity", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "hello" });

    expect(document.getMarkdown()).toBe("hello");
    expect(document.getState()).toMatchObject({
      lifecycle: "open",
      sync: "synced",
      persistence: "volatile",
      consistency: "healthy",
    });
    const renamed = await engine.open({ ...ref(), sourcePath: "renamed/shared.md" });
    expect(renamed.getMarkdown()).toBe("hello");
    await renamed.close();
    await expect(engine.create(ref(), { initialMarkdown: "duplicate" })).rejects.toMatchObject({
      code: "document-already-exists",
    });
    await expect(engine.open({ ...ref(), hostIdentity: "different-vault" })).rejects.toMatchObject({
      code: "document-identity-mismatch",
    });

    await document.close();
    await engine.close();
    await hub.close();
  });

  it("does not seed a missing document through open", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    await expect(engine.open(ref())).rejects.toMatchObject({ code: "document-not-found" });
    expect(engine.list()).toHaveLength(0);
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });
    await engine.close();
    await hub.close();
  });

  it("keeps first-join readiness pending while initial synchronization is offline", async () => {
    const hub = createAssessmentProviderHub();
    hub.setOnline(false);
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    let settled = false;
    const opening = engine.open(ref()).finally(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(engine.getSnapshot(ref().id)).toMatchObject({ transport: "offline", sync: "stale" });

    hub.setOnline(true);
    await expect(opening).rejects.toMatchObject({ code: "document-not-found" });
    expect(settled).toBe(true);
    await engine.close();
    await hub.close();
  });

  it("releases an offline initial-sync waiter when the Engine closes", async () => {
    const hub = createAssessmentProviderHub();
    hub.setOnline(false);
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const opening = engine.open(ref());
    await Promise.resolve();
    await engine.close();

    await expect(opening).rejects.toMatchObject({ code: "engine-closed" });
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });
    await hub.close();
  });

  it("deduplicates concurrent opens while returning independent handles", async () => {
    const hub = createAssessmentProviderHub();
    const creator = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const created = await creator.create(ref(), { initialMarkdown: "shared" });
    const joiner = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });

    const [first, second] = await Promise.all([joiner.open(ref()), joiner.open(ref())]);
    expect(first).not.toBe(second);
    expect(joiner.list()).toHaveLength(1);
    await first.close();
    expect(second.getMarkdown()).toBe("shared");
    await second.close();
    expect(joiner.list()).toHaveLength(0);

    await closeAll(created, creator, joiner);
    await hub.close();
  });

  it("converges accepted proposals across two Editors and never echoes authoritative updates", async () => {
    const hub = createAssessmentProviderHub();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const secondEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const firstDocument = await firstEngine.create(ref(), { initialMarkdown: "ab" });
    const secondDocument = await secondEngine.open(ref());
    const firstEditor = editor("stale");
    const secondEditor = editor("ab");
    const firstBinding = await firstDocument.attach(firstEditor.editor, { content: "replace-editor" });
    const secondBinding = await secondDocument.attach(secondEditor.editor, { content: "require-match" });
    const firstUpdates = vi.fn();
    firstEditor.editor.getContributionSink().registerUpdateListener("test", firstUpdates);

    firstEditor.editor.dispatchTransaction({
      changes: [{ from: 1, to: 1, insert: "X" }],
      origin: ["test-local"],
    });

    expect(firstDocument.getMarkdown()).toBe("aXb");
    expect(firstEditor.editor.getDocument()).toBe("aXb");
    expect(secondEditor.editor.getDocument()).toBe("aXb");
    expect(firstUpdates.mock.calls.filter(([update]) => update.authority === "authoritative")).toHaveLength(0);

    await firstBinding.detach();
    await secondBinding.detach();
    firstEditor.editor.destroy();
    secondEditor.editor.destroy();
    firstEditor.container.remove();
    secondEditor.container.remove();
    await closeAll(firstDocument, secondDocument, firstEngine, secondEngine);
    await hub.close();
  });

  it("publishes only the final proposal accepted by Core filters", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "ab" });
    const target = editor("ab");
    const rejected = target.editor.getContributionSink().registerTransactionFilter("assessment-policy", () => ({
      action: "reject",
      reason: "blocked",
    }), { priority: 20 });
    const binding = await document.attach(target.editor, { content: "require-match" });

    expect(target.editor.dispatchTransaction({
      changes: [{ from: 1, to: 1, insert: "x" }],
      origin: ["rejected"],
    })).toMatchObject({ status: "rejected", reason: "blocked" });
    expect(document.getMarkdown()).toBe("ab");

    await rejected.dispose();
    target.editor.getContributionSink().registerTransactionFilter("assessment-normalizer", (update) => ({
      action: "replace",
      transaction: {
        changes: update.changes.map((change) => ({ ...change, insert: change.insert.toUpperCase() })),
        selection: update.selectionAfter,
        origin: ["normalized"],
      },
    }), { priority: 20 });
    target.editor.dispatchTransaction({
      changes: [{ from: 1, to: 1, insert: "x" }],
      origin: ["accepted"],
    });
    expect(target.editor.getDocument()).toBe("aXb");
    expect(document.getMarkdown()).toBe("aXb");

    await binding.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("uses per-Binding undo and preserves another participant's edit", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "" });
    const left = editor();
    const right = editor();
    const leftBinding = await document.attach(left.editor, { content: "require-match" });
    const rightBinding = await document.attach(right.editor, { content: "require-match" });

    left.editor.dispatchTransaction({ changes: [{ from: 0, to: 0, insert: "L" }], origin: ["left"] });
    right.editor.dispatchTransaction({ changes: [{ from: 1, to: 1, insert: "R" }], origin: ["right"] });
    expect(document.getMarkdown()).toBe("LR");
    expect(left.editor.undo()).toBe(true);
    expect(document.getMarkdown()).toBe("R");
    expect(left.editor.getDocument()).toBe("R");
    expect(right.editor.getDocument()).toBe("R");

    await leftBinding.detach();
    await rightBinding.detach();
    left.editor.destroy();
    right.editor.destroy();
    left.container.remove();
    right.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("queues bounded offline updates and converges after reconnect", async () => {
    const hub = createAssessmentProviderHub({ maxQueuedUpdates: 16 });
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const secondEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const first = await firstEngine.create(ref(), { initialMarkdown: "a" });
    const second = await secondEngine.open(ref());
    const left = editor("a");
    const right = editor("a");
    const leftBinding = await first.attach(left.editor, { content: "require-match" });
    const rightBinding = await second.attach(right.editor, { content: "require-match" });

    hub.setOnline(false);
    left.editor.dispatchTransaction({ changes: [{ from: 1, to: 1, insert: "L" }], origin: ["left"] });
    right.editor.dispatchTransaction({ changes: [{ from: 1, to: 1, insert: "R" }], origin: ["right"] });
    expect(left.editor.getDocument()).not.toBe(right.editor.getDocument());
    hub.setOnline(true);
    await hub.flush();
    expect(left.editor.getDocument()).toBe(right.editor.getDocument());
    expect(first.getState().transport).toBe("online");
    expect(second.getState().sync).toBe("synced");

    await leftBinding.detach();
    await rightBinding.detach();
    left.editor.destroy();
    right.editor.destroy();
    left.container.remove();
    right.container.remove();
    await closeAll(first, second, firstEngine, secondEngine);
    await hub.close();
  });

  it("converges concurrent Unicode edits and ignores replayed state updates", async () => {
    const hub = createAssessmentProviderHub();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const secondEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const first = await firstEngine.create(ref(), { initialMarkdown: "中心" });
    const second = await secondEngine.open(ref());
    const left = editor("中心");
    const right = editor("中心");
    const leftBinding = await first.attach(left.editor, { content: "require-match" });
    const rightBinding = await second.attach(right.editor, { content: "require-match" });

    hub.setOnline(false);
    left.editor.dispatchTransaction({ changes: [{ from: 1, to: 1, insert: "左🚀" }], origin: ["left"] });
    right.editor.dispatchTransaction({ changes: [{ from: 1, to: 1, insert: "右🧭" }], origin: ["right"] });
    hub.setOnline(true);
    await hub.flush();
    const converged = left.editor.getDocument();
    expect(right.editor.getDocument()).toBe(converged);
    expect(converged).toContain("左🚀");
    expect(converged).toContain("右🧭");
    await hub.flush();
    await hub.flush();
    expect(left.editor.getDocument()).toBe(converged);
    expect(right.editor.getDocument()).toBe(converged);

    await leftBinding.detach();
    await rightBinding.detach();
    left.editor.destroy();
    right.editor.destroy();
    left.container.remove();
    right.container.remove();
    await closeAll(first, second, firstEngine, secondEngine);
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });
    await hub.close();
  });

  it("keeps local IME text and an authoritative peer update in sync", async () => {
    const hub = createAssessmentProviderHub();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const secondEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const first = await firstEngine.create(ref(), { initialMarkdown: "ab" });
    const second = await secondEngine.open(ref());
    const left = editor("ab");
    const right = editor("ab");
    const leftBinding = await first.attach(left.editor, { content: "require-match" });
    const rightBinding = await second.attach(right.editor, { content: "require-match" });
    const content = left.container.querySelector<HTMLElement>(".cm-content");
    expect(content).not.toBeNull();

    content!.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    expect(left.editor.isComposing()).toBe(true);
    left.editor.dispatchTransaction({
      changes: [{ from: 1, to: 1, insert: "你好" }],
      origin: ["ime-local"],
      userEvent: "input.type.compose",
    });
    right.editor.dispatchTransaction({
      changes: [{ from: right.editor.getDocument().length, to: right.editor.getDocument().length, insert: "!" }],
      origin: ["peer"],
    });
    content!.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "你好" }));

    expect(left.editor.getDocument()).toBe(right.editor.getDocument());
    expect(left.editor.getDocument()).toContain("你好");
    expect(left.editor.getDocument()).toContain("!");

    await leftBinding.detach();
    await rightBinding.detach();
    left.editor.destroy();
    right.editor.destroy();
    left.container.remove();
    right.container.remove();
    await closeAll(first, second, firstEngine, secondEngine);
    await hub.close();
  });

  it("restores updates through the Store and reports persistence independently", async () => {
    const hub = createAssessmentProviderHub();
    const store = createAssessmentMemoryStore();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store });
    const first = await firstEngine.create(ref(), { initialMarkdown: "durable-ish" });
    expect(first.getState().persistence).toBe("clean");
    await closeAll(first, firstEngine);

    const secondEngine = createCollaborationEngine({ providers: hub.factory, store });
    const restored = await secondEngine.open(ref());
    expect(restored.getMarkdown()).toBe("durable-ish");
    await closeAll(restored, secondEngine);
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });
    expect(store.inspect().documents).toBe(1);
    await store.close();
    await hub.close();
  });

  it("reports a later Store append failure without claiming clean persistence", async () => {
    const hub = createAssessmentProviderHub();
    let appends = 0;
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [] }),
          append: async () => {
            appends += 1;
            if (appends > 1) throw new Error("injected append failure");
          },
          flush: async () => undefined,
          close: async () => undefined,
        };
      },
    };
    const engine = createCollaborationEngine({ providers: hub.factory, store });
    const document = await engine.create(ref(), { initialMarkdown: "a" });
    const target = editor("a");
    const binding = await document.attach(target.editor, { content: "require-match" });

    target.editor.dispatchTransaction({
      changes: [{ from: 1, to: 1, insert: "b" }],
      origin: ["store-failure-test"],
    });
    await vi.waitFor(() => expect(document.getState().persistence).toBe("failed"));
    expect(document.getState().diagnostic?.code).toBe("store-failed");
    expect(document.getMarkdown()).toBe("ab");

    await binding.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("sanitizes Presence and removes it on detach without changing content", async () => {
    const hub = createAssessmentProviderHub();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const secondEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const first = await firstEngine.create(ref(), { initialMarkdown: "text" });
    const second = await secondEngine.open(ref());
    const left = editor("text");
    const binding = await first.attach(left.editor, { content: "require-match" });
    binding.setPresence({
      userId: "user-1",
      name: "<img src=x onerror=alert(1)>".repeat(20),
      color: "url(javascript:alert(1))",
      avatarUrl: "javascript:alert(1)",
    });

    const peer = second.getState().peers.find((item) => item.userId === "user-1");
    expect(peer?.name.length).toBeLessThanOrEqual(80);
    expect(peer?.color).toBe("#6d5dfc");
    expect(peer?.avatarUrl).toBeUndefined();
    expect(second.getMarkdown()).toBe("text");
    await binding.detach();
    expect(second.getState().peers.some((item) => item.userId === "user-1")).toBe(false);

    left.editor.destroy();
    left.container.remove();
    await closeAll(first, second, firstEngine, secondEngine);
    await hub.close();
  });

  it("publishes a Presence tombstone when its Engine closes", async () => {
    const hub = createAssessmentProviderHub();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const secondEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const first = await firstEngine.create(ref(), { initialMarkdown: "text" });
    const second = await secondEngine.open(ref());
    const left = editor("text");
    const binding = await first.attach(left.editor, { content: "require-match" });
    binding.setPresence({ userId: "departing-user", name: "Departing user", color: "#123456" });
    expect(second.getState().peers.some((peer) => peer.userId === "departing-user")).toBe(true);

    await firstEngine.close();
    expect(second.getState().peers.some((peer) => peer.userId === "departing-user")).toBe(false);

    left.editor.destroy();
    left.container.remove();
    await closeAll(first, second, secondEngine);
    await hub.close();
  });

  it("rejects attach mismatch and stale handle operations with stable errors", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document: CollaborativeDocumentHandle = await engine.create(ref(), { initialMarkdown: "one" });
    const target = editor("two");

    await expect(document.attach(target.editor, { content: "require-match" })).rejects.toBeInstanceOf(CollaborationError);
    await document.close();
    await expect(document.whenReady()).rejects.toMatchObject({ code: "handle-closed" });
    await expect(document.attach(target.editor, { content: "replace-editor" })).rejects.toMatchObject({
      code: "handle-closed",
    });

    target.editor.destroy();
    target.container.remove();
    await engine.close();
    await hub.close();
  });

  it("invalidates outstanding document and Binding handles when the Engine closes", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "one" });
    const target = editor("one");
    const binding = await document.attach(target.editor, { content: "require-match" });

    await engine.close();
    expect(document.closed).toBe(true);
    expect(document.getMarkdown()).toBeUndefined();
    expect(binding.detached).toBe(true);
    await expect(document.whenReady()).rejects.toMatchObject({ code: "handle-closed" });
    await expect(document.attach(target.editor, { content: "require-match" })).rejects.toMatchObject({
      code: "handle-closed",
    });

    target.editor.destroy();
    target.container.remove();
    await document.close();
    await hub.close();
  });

  it("refuses to attach while an Editor mouse interaction is active", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "one" });
    const target = editor("one");
    const root = target.container.querySelector(".cm-editor");
    expect(root).toBeInstanceOf(HTMLElement);
    root!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    await expect(document.attach(target.editor, { content: "require-match" })).rejects.toMatchObject({
      code: "interaction-active",
    });
    window.dispatchEvent(new MouseEvent("mouseup"));

    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("allows only one winner when two bindings race for the same Editor", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "one" });
    const target = editor("one");

    const attempts = await Promise.allSettled([
      document.attach(target.editor, { content: "require-match" }),
      document.attach(target.editor, { content: "require-match" }),
    ]);
    const fulfilled = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(document.getState().bindings).toBe(1);

    if (fulfilled[0]?.status === "fulfilled") await fulfilled[0].value.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("isolates document, Engine, and diagnostic listener failures", async () => {
    const hub = createAssessmentProviderHub();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const diagnostics = vi.fn(() => {
      throw new Error("injected diagnostic listener failure");
    });
    const engine = createCollaborationEngine({
      providers: hub.factory,
      store: { mode: "volatile" },
      diagnostics,
    });
    const document = await engine.create(ref(), { initialMarkdown: "one" });
    engine.subscribe(() => {
      throw new Error("injected Engine listener failure");
    });
    document.subscribe(() => {
      throw new Error("injected document listener failure");
    });

    hub.setOnline(false);
    expect(document.getState()).toMatchObject({ transport: "offline", sync: "stale" });
    hub.setOnline(true);
    expect(document.getState()).toMatchObject({ lifecycle: "open", transport: "online", sync: "synced" });
    expect(diagnostics).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();

    await closeAll(document, engine);
    await hub.close();
    consoleError.mockRestore();
  });
});
