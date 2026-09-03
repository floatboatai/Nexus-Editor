import { createEditor } from "@floatboat/nexus-core";
import { Awareness } from "y-protocols/awareness";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  CollaborationError,
  asDocumentId,
  createCollaborationEngine,
  type CollaborativeDocumentHandle,
  type CollaborationProviderFactory,
  type ProviderState,
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

function failAfterDispose<T extends { dispose(): Promise<void> }>(
  registration: T,
  failure: Error,
  calls: string[],
  label: string,
): T {
  return new Proxy(registration, {
    get(target, property) {
      if (property === "dispose") {
        return async () => {
          calls.push(label);
          await target.dispose();
          throw failure;
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
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

  it("rejects local proposals for a read-only binding while projecting authoritative updates", async () => {
    const hub = createAssessmentProviderHub();
    const writerEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const readerEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const writerDocument = await writerEngine.create(ref(), { initialMarkdown: "shared" });
    const readerDocument = await readerEngine.open(ref());
    const writer = editor("shared");
    const reader = editor("shared");
    const writerBinding = await writerDocument.attach(writer.editor, { content: "require-match" });
    const readerBinding = await readerDocument.attach(reader.editor, {
      content: "require-match",
      access: "read-only",
    });

    expect(reader.editor.dispatchTransaction({
      changes: [{ from: 6, to: 6, insert: " blocked" }],
      origin: ["reader-local"],
    })).toMatchObject({ status: "rejected", reason: "collaboration-read-only" });

    expect(writer.editor.dispatchTransaction({
      changes: [{ from: 6, to: 6, insert: " remote" }],
      origin: ["writer-local"],
    })).toMatchObject({ status: "success" });
    expect(reader.editor.getDocument()).toBe("shared remote");
    expect(readerDocument.getMarkdown()).toBe("shared remote");

    await readerBinding.detach();
    const upgradedBinding = await readerDocument.attach(reader.editor, {
      content: "require-match",
      access: "read-write",
    });
    expect(reader.editor.dispatchTransaction({
      changes: [{ from: 13, to: 13, insert: " edited" }],
      origin: ["upgraded-editor"],
    })).toMatchObject({ status: "success" });
    expect(writer.editor.getDocument()).toBe("shared remote edited");

    await upgradedBinding.detach();
    await writerBinding.detach();
    reader.editor.destroy();
    writer.editor.destroy();
    reader.container.remove();
    writer.container.remove();
    await closeAll(readerDocument, writerDocument, readerEngine, writerEngine);
    await hub.close();
  });

  it("blocks undo and redo when Provider access is downgraded to read-only", async () => {
    let state: ProviderState = {
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: "read-write",
    };
    const listeners = new Set<(next: ProviderState) => void>();
    const providers: CollaborationProviderFactory = {
      async prepare() {
        return {
          async start() {},
          getState: () => state,
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          async release() {},
        };
      },
    };
    const publishAccess = (access: ProviderState["access"]): void => {
      state = { ...state, access };
      for (const listener of listeners) listener(state);
    };
    const engine = createCollaborationEngine({ providers, store: { mode: "volatile" } });
    const document = await engine.create(ref("document-history-authorization"), {
      initialMarkdown: "base",
    });
    const target = editor("base");
    const binding = await document.attach(target.editor, { content: "require-match" });

    expect(target.editor.dispatchTransaction({
      changes: [{ from: 4, to: 4, insert: "-editor" }],
      origin: ["authorized-editor"],
    })).toMatchObject({ status: "success" });
    publishAccess("read-only");
    expect(target.editor.undo()).toBe(false);
    expect(document.getMarkdown()).toBe("base-editor");

    publishAccess("read-write");
    expect(target.editor.undo()).toBe(true);
    expect(document.getMarkdown()).toBe("base");
    publishAccess("read-only");
    expect(target.editor.redo()).toBe(false);
    expect(document.getMarkdown()).toBe("base");

    await binding.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);
  });

  it("finishes Binding cleanup and shares one failed detach across concurrent callers", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "shared" });
    const target = editor("shared");
    const sink = target.editor.getContributionSink();
    const calls: string[] = [];
    const listenerFailure = new Error("listener disposer failed");
    const filterFailure = new Error("filter disposer failed");
    const registerListener = sink.registerUpdateListener.bind(sink);
    const registerFilter = sink.registerTransactionFilter.bind(sink);
    const listenerSpy = vi.spyOn(sink, "registerUpdateListener").mockImplementation(
      (ownerId, listener, options) => failAfterDispose(
        registerListener(ownerId, listener, options),
        listenerFailure,
        calls,
        "listener",
      ),
    );
    const filterSpy = vi.spyOn(sink, "registerTransactionFilter").mockImplementation(
      (ownerId, filter, options) => failAfterDispose(
        registerFilter(ownerId, filter, options),
        filterFailure,
        calls,
        "filter",
      ),
    );
    const binding = await document.attach(target.editor, { content: "require-match" });

    const firstDetach = binding.detach();
    const concurrentDetach = binding.detach();
    const detachResults = Promise.allSettled([firstDetach, concurrentDetach]);
    expect(concurrentDetach).toBe(firstDetach);
    const [firstResult, concurrentResult] = await detachResults;
    expect(firstResult.status).toBe("rejected");
    expect(concurrentResult.status).toBe("rejected");
    if (firstResult.status === "rejected") {
      expect(firstResult.reason).toBeInstanceOf(AggregateError);
      expect((firstResult.reason as AggregateError).errors).toEqual([listenerFailure, filterFailure]);
    }
    if (concurrentResult.status === "rejected" && firstResult.status === "rejected") {
      expect(concurrentResult.reason).toBe(firstResult.reason);
    }
    expect(calls).toEqual(["listener", "filter"]);
    expect(binding.detached).toBe(true);
    expect(document.getState().bindings).toBe(0);

    const repeatedDetach = binding.detach();
    expect(repeatedDetach).toBe(firstDetach);
    await expect(repeatedDetach).rejects.toBe(firstResult.status === "rejected" ? firstResult.reason : undefined);

    listenerSpy.mockRestore();
    filterSpy.mockRestore();
    const replacement = await document.attach(target.editor, { content: "require-match" });
    await replacement.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("detaches immediately when its Editor is destroyed without quarantining on later remote updates", async () => {
    const hub = createAssessmentProviderHub();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const secondEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const firstDocument = await firstEngine.create(ref("editor-destroy-cleanup"), {
      initialMarkdown: "shared",
    });
    const secondDocument = await secondEngine.open(ref("editor-destroy-cleanup"));
    const firstTarget = editor("shared");
    const secondTarget = editor("shared");
    const firstBinding = await firstDocument.attach(firstTarget.editor, { content: "require-match" });
    const secondBinding = await secondDocument.attach(secondTarget.editor, { content: "require-match" });
    firstBinding.setPresence({ userId: "destroyed-editor", name: "Destroyed", color: "#123456" });
    expect(secondDocument.getState().peers.some((peer) => peer.userId === "destroyed-editor")).toBe(true);

    firstTarget.editor.destroy();

    expect(firstBinding.detached).toBe(true);
    expect((firstDocument as unknown as { bindings: Set<unknown> }).bindings.size).toBe(0);
    expect(firstDocument.getState()).toMatchObject({ bindings: 0, consistency: "healthy" });
    expect(secondDocument.getState().peers.some((peer) => peer.userId === "destroyed-editor")).toBe(false);
    expect(secondTarget.editor.dispatchTransaction({
      changes: [{ from: 6, to: 6, insert: "!" }],
      origin: ["surviving-editor"],
    }).status).toBe("success");
    expect(firstDocument.getMarkdown()).toBe("shared!");
    expect(firstDocument.getState()).toMatchObject({ bindings: 0, consistency: "healthy" });

    await firstBinding.detach();
    await secondBinding.detach();
    secondTarget.editor.destroy();
    firstTarget.container.remove();
    secondTarget.container.remove();
    await closeAll(firstDocument, secondDocument, firstEngine, secondEngine);
    await hub.close();
  });

  it("reports asynchronous Binding cleanup failures after direct Editor destruction", async () => {
    const hub = createAssessmentProviderHub();
    const diagnostics = vi.fn();
    const engine = createCollaborationEngine({
      providers: hub.factory,
      store: { mode: "volatile" },
      diagnostics,
    });
    const document = await engine.create(ref("editor-destroy-cleanup-failure"), {
      initialMarkdown: "shared",
    });
    const target = editor("shared");
    const sink = target.editor.getContributionSink();
    const calls: string[] = [];
    const listenerFailure = new Error("listener cleanup failed after destroy");
    const filterFailure = new Error("filter cleanup failed after destroy");
    const registerListener = sink.registerUpdateListener.bind(sink);
    const registerFilter = sink.registerTransactionFilter.bind(sink);
    vi.spyOn(sink, "registerUpdateListener").mockImplementation(
      (ownerId, listener, options) => failAfterDispose(
        registerListener(ownerId, listener, options),
        listenerFailure,
        calls,
        "listener",
      ),
    );
    vi.spyOn(sink, "registerTransactionFilter").mockImplementation(
      (ownerId, filter, options) => failAfterDispose(
        registerFilter(ownerId, filter, options),
        filterFailure,
        calls,
        "filter",
      ),
    );
    const binding = await document.attach(target.editor, { content: "require-match" });

    target.editor.destroy();

    expect(binding.detached).toBe(true);
    expect(document.getState().bindings).toBe(0);
    await expect(binding.detach()).rejects.toBeInstanceOf(AggregateError);
    await vi.waitFor(() => expect(diagnostics).toHaveBeenCalledWith(expect.objectContaining({
      code: "editor-destroy-cleanup-failed",
      documentId: document.id,
      cause: expect.any(AggregateError),
    })));
    const diagnostic = diagnostics.mock.calls.find(([item]) => item.code === "editor-destroy-cleanup-failed")?.[0];
    expect((diagnostic?.cause as AggregateError).errors).toEqual([listenerFailure, filterFailure]);
    expect(calls).toEqual(["listener", "filter"]);

    target.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("does not retain a Binding when its Editor is destroyed at the attach handoff", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref("editor-destroy-attach-handoff"), {
      initialMarkdown: "shared",
    });
    const target = editor("shared");

    const attaching = document.attach(target.editor, { content: "require-match" });
    queueMicrotask(() => target.editor.destroy());

    await expect(attaching).rejects.toMatchObject({ code: "binding-conflict" });
    expect((document as unknown as { bindings: Set<unknown> }).bindings.size).toBe(0);
    expect(document.getState()).toMatchObject({ bindings: 0, consistency: "healthy" });

    target.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("closes every Binding and the Replica while concurrent Document close callers share failures", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "shared" });
    const firstTarget = editor("shared");
    const secondTarget = editor("shared");
    const failures = [new Error("first binding cleanup failed"), new Error("second binding cleanup failed")];
    const calls: string[] = [];
    const firstSink = firstTarget.editor.getContributionSink();
    const secondSink = secondTarget.editor.getContributionSink();
    const firstRegister = firstSink.registerUpdateListener.bind(firstSink);
    const secondRegister = secondSink.registerUpdateListener.bind(secondSink);
    vi.spyOn(firstSink, "registerUpdateListener").mockImplementation(
      (ownerId, listener, options) => failAfterDispose(
        firstRegister(ownerId, listener, options),
        failures[0]!,
        calls,
        "first",
      ),
    );
    vi.spyOn(secondSink, "registerUpdateListener").mockImplementation(
      (ownerId, listener, options) => failAfterDispose(
        secondRegister(ownerId, listener, options),
        failures[1]!,
        calls,
        "second",
      ),
    );
    const firstBinding = await document.attach(firstTarget.editor, { content: "require-match" });
    const secondBinding = await document.attach(secondTarget.editor, { content: "require-match" });

    const firstClose = document.close();
    const concurrentClose = document.close();
    const closeResults = Promise.allSettled([firstClose, concurrentClose]);
    expect(concurrentClose).toBe(firstClose);
    const [firstResult, concurrentResult] = await closeResults;
    expect(firstResult.status).toBe("rejected");
    expect(concurrentResult.status).toBe("rejected");
    if (firstResult.status === "rejected") {
      expect(firstResult.reason).toBeInstanceOf(AggregateError);
      expect((firstResult.reason as AggregateError).errors).toEqual(failures);
    }
    if (concurrentResult.status === "rejected" && firstResult.status === "rejected") {
      expect(concurrentResult.reason).toBe(firstResult.reason);
    }
    expect(calls).toEqual(["first", "second"]);
    expect(firstBinding.detached).toBe(true);
    expect(secondBinding.detached).toBe(true);
    expect(document.closed).toBe(true);
    expect(engine.list()).toHaveLength(0);
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });

    const repeatedClose = document.close();
    expect(repeatedClose).toBe(firstClose);
    await expect(repeatedClose).rejects.toBe(firstResult.status === "rejected" ? firstResult.reason : undefined);

    firstTarget.editor.destroy();
    secondTarget.editor.destroy();
    firstTarget.container.remove();
    secondTarget.container.remove();
    await engine.close();
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

  it("exposes authenticated read-only access and rejects local proposals", async () => {
    const hub = createAssessmentProviderHub();
    const writerEngine = createCollaborationEngine({
      providers: hub.factory,
      store: { mode: "volatile" },
    });
    const writerDocument = await writerEngine.create(ref(), { initialMarkdown: "shared" });
    const readOnlyFactory = {
      async prepare(context: Parameters<typeof hub.factory.prepare>[0]) {
        const lease = await hub.factory.prepare(context);
        const readOnlyState = () => ({
          ...lease.getState(),
          authentication: "authenticated" as const,
          access: "read-only" as const,
        });
        return {
          start: () => lease.start(),
          getState: readOnlyState,
          subscribe(listener: Parameters<typeof lease.subscribe>[0]) {
            return lease.subscribe(() => listener(readOnlyState()));
          },
          release: () => lease.release(),
        };
      },
    };
    const readerEngine = createCollaborationEngine({
      providers: readOnlyFactory,
      store: { mode: "volatile" },
    });
    const readerDocument = await readerEngine.open(ref());
    const target = editor("shared");
    const binding = await readerDocument.attach(target.editor, { content: "require-match" });

    expect(readerDocument.getState()).toMatchObject({
      authentication: "authenticated",
      access: "read-only",
    });
    expect(target.editor.dispatchTransaction({
      changes: [{ from: 6, to: 6, insert: " blocked" }],
      origin: ["read-only-test"],
    })).toMatchObject({ status: "rejected", reason: "collaboration-read-only" });
    expect(target.editor.getDocument()).toBe("shared");
    expect(writerDocument.getMarkdown()).toBe("shared");

    await binding.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(readerDocument, writerDocument, readerEngine, writerEngine);
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

  it("starts durable create from remote authority before replacing an old local cache", async () => {
    const store = createAssessmentMemoryStore();
    const seedProviders: CollaborationProviderFactory = {
      async prepare() {
        const state: ProviderState = {
          transport: "online",
          sync: "synced",
          authentication: "authenticated",
          access: "read-write",
        };
        return {
          async start() {},
          getState: () => state,
          subscribe: () => () => undefined,
          async release() {},
        };
      },
    };
    const documentRef = ref("document-create-remote-first");
    const seedEngine = createCollaborationEngine({ providers: seedProviders, store });
    const cached = await seedEngine.create(documentRef, { initialMarkdown: "stale local cache" });
    await closeAll(cached, seedEngine);

    let providerInitialState: { readonly created: unknown; readonly markdown: string } | undefined;
    const providers: CollaborationProviderFactory = {
      async prepare(context) {
        const state: ProviderState = {
          transport: "online",
          sync: "synced",
          authentication: "authenticated",
          access: "read-write",
        };
        return {
          async start() {
            const observed = new Y.Doc();
            Y.applyUpdate(observed, context.replica.encodeStateAsUpdate());
            providerInitialState = {
              created: observed.getMap("nexus:meta").get("created"),
              markdown: observed.getText("content").toString(),
            };
            observed.destroy();
          },
          getState: () => state,
          subscribe: () => () => undefined,
          async release() {},
        };
      },
    };
    const engine = createCollaborationEngine({ providers, store });
    const created = await engine.create(documentRef, { initialMarkdown: "fresh remote create" });

    expect(providerInitialState).toEqual({ created: undefined, markdown: "" });
    expect(created.getMarkdown()).toBe("fresh remote create");
    expect(created.getState().persistence).toBe("clean");
    await closeAll(created, engine);

    const restored = new Y.Doc();
    const lease = await store.open(documentRef.id);
    const stored = await lease.load();
    for (const update of stored.updates) Y.applyUpdate(restored, update);
    expect(restored.getText("content").toString()).toBe("fresh remote create");
    restored.destroy();
    await lease.close();
    await store.close();
  });

  it("leaves an old durable cache unchanged when remote create finds an existing document", async () => {
    const store = createAssessmentMemoryStore();
    const readyState: ProviderState = {
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: "read-write",
    };
    const emptyProviders: CollaborationProviderFactory = {
      async prepare() {
        return {
          async start() {},
          getState: () => readyState,
          subscribe: () => () => undefined,
          async release() {},
        };
      },
    };
    const documentRef = ref("document-create-existing-remote");
    const seedEngine = createCollaborationEngine({ providers: emptyProviders, store });
    const cached = await seedEngine.create(documentRef, { initialMarkdown: "preserved local cache" });
    await closeAll(cached, seedEngine);
    const beforeLease = await store.open(documentRef.id);
    const before = (await beforeLease.load()).updates.map((update) => [...update]);
    await beforeLease.close();

    const remote = new Y.Doc();
    const remoteMeta = remote.getMap("nexus:meta");
    remote.transact(() => {
      remoteMeta.set("schemaVersion", 1);
      remoteMeta.set("documentId", documentRef.id);
      remoteMeta.set("hostIdentity", documentRef.hostIdentity);
      remoteMeta.set("created", true);
      remoteMeta.set("createdAt", "2026-09-03T00:00:00.000Z");
      remote.getText("content").insert(0, "existing remote authority");
    });
    const remoteUpdate = Y.encodeStateAsUpdate(remote);
    const providers: CollaborationProviderFactory = {
      async prepare(context) {
        return {
          async start() { context.replica.applyUpdate(remoteUpdate); },
          getState: () => readyState,
          subscribe: () => () => undefined,
          async release() {},
        };
      },
    };
    const engine = createCollaborationEngine({ providers, store });

    await expect(engine.create(documentRef, { initialMarkdown: "must not seed" }))
      .rejects.toMatchObject({ code: "document-already-exists" });
    const afterLease = await store.open(documentRef.id);
    const after = await afterLease.load();
    expect(after.updates.map((update) => [...update])).toEqual(before);
    const restored = new Y.Doc();
    for (const update of after.updates) Y.applyUpdate(restored, update);
    expect(restored.getText("content").toString()).toBe("preserved local cache");

    restored.destroy();
    remote.destroy();
    await afterLease.close();
    await engine.close();
    await store.close();
  });

  it("does not expose or overwrite an old durable create cache when authentication fails", async () => {
    const store = createAssessmentMemoryStore();
    const readyState: ProviderState = {
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: "read-write",
    };
    const seedProviders: CollaborationProviderFactory = {
      async prepare() {
        return {
          async start() {},
          getState: () => readyState,
          subscribe: () => () => undefined,
          async release() {},
        };
      },
    };
    const documentRef = ref("document-create-authentication-failure");
    const seedEngine = createCollaborationEngine({ providers: seedProviders, store });
    const cached = await seedEngine.create(documentRef, { initialMarkdown: "preserved local cache" });
    await closeAll(cached, seedEngine);
    const beforeLease = await store.open(documentRef.id);
    const before = (await beforeLease.load()).updates.map((update) => [...update]);
    await beforeLease.close();

    let providerInitialMarkdown: string | undefined;
    const deniedState: ProviderState = {
      transport: "failed",
      sync: "failed",
      authentication: "denied",
      access: "none",
      diagnostic: {
        code: "authentication-denied",
        message: "Credential was denied",
        documentId: documentRef.id,
      },
    };
    const deniedProviders: CollaborationProviderFactory = {
      async prepare(context) {
        return {
          async start() {
            const observed = new Y.Doc();
            Y.applyUpdate(observed, context.replica.encodeStateAsUpdate());
            providerInitialMarkdown = observed.getText("content").toString();
            observed.destroy();
            throw new CollaborationError("authentication-denied", "Credential was denied");
          },
          getState: () => deniedState,
          subscribe: () => () => undefined,
          async release() {},
        };
      },
    };
    const engine = createCollaborationEngine({ providers: deniedProviders, store });

    await expect(engine.create(documentRef, { initialMarkdown: "must not seed" }))
      .rejects.toMatchObject({ code: "authentication-denied" });
    expect(providerInitialMarkdown).toBe("");
    const afterLease = await store.open(documentRef.id);
    const after = await afterLease.load();
    expect(after.updates.map((update) => [...update])).toEqual(before);

    await afterLease.close();
    await engine.close();
    await store.close();
  });

  it("compacts a durable journal through a verified Store checkpoint", async () => {
    const hub = createAssessmentProviderHub();
    const store = createAssessmentMemoryStore();
    const engine = createCollaborationEngine({
      providers: hub.factory,
      store,
      storeCompaction: { updateThreshold: 2 },
    });
    const document = await engine.create(ref(), { initialMarkdown: "a" });
    const target = editor("a");
    const binding = await document.attach(target.editor, { content: "require-match" });

    target.editor.dispatchTransaction({
      changes: [{ from: 1, to: 1, insert: "b" }],
      origin: ["compaction-test"],
    });
    expect(document.getState().persistence).toBe("pending");
    await vi.waitFor(() => expect(document.getState().persistence).toBe("clean"));

    await binding.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);
    const persisted = await store.open(ref().id);
    expect((await persisted.load()).updates).toHaveLength(1);
    await persisted.close();

    const reopenedEngine = createCollaborationEngine({ providers: hub.factory, store });
    const reopened = await reopenedEngine.open(ref());
    expect(reopened.getMarkdown()).toBe("ab");

    await closeAll(reopened, reopenedEngine);
    await store.close();
    await hub.close();
  });

  it("does not report clean while a later durable append is still pending", async () => {
    const hub = createAssessmentProviderHub();
    const pendingAppends: Array<{
      readonly update: Uint8Array;
      resolve(): void;
    }> = [];
    let sequence = 0;
    let deferAppends = false;
    const generation = "ordered-persistence-generation";
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence } }),
          append: async (update: Uint8Array) => {
            sequence += 1;
            if (!deferAppends) return { generation, sequence };
            await new Promise<void>((resolve) => {
              pendingAppends.push({ update: new Uint8Array(update), resolve });
            });
            return { generation, sequence };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation, sequence }),
          close: async () => undefined,
        };
      },
    };
    const engine = createCollaborationEngine({ providers: hub.factory, store });
    const collaborativeDocument = await engine.create(ref(), { initialMarkdown: "a" });
    deferAppends = true;

    const first = collaborativeDocument.getMarkdownSnapshot();
    if (!first) throw new Error("expected an open Collaborative Document");
    await collaborativeDocument.replaceMarkdown("ab", {
      origin: "external-file",
      expectedRevision: first.revision,
    });
    await vi.waitFor(() => expect(pendingAppends).toHaveLength(1));
    const second = collaborativeDocument.getMarkdownSnapshot();
    if (!second) throw new Error("expected an open Collaborative Document");
    await collaborativeDocument.replaceMarkdown("abc", {
      origin: "external-file",
      expectedRevision: second.revision,
    });

    pendingAppends[0]!.resolve();
    await vi.waitFor(() => expect(pendingAppends).toHaveLength(2));
    expect(collaborativeDocument.getState().persistence).toBe("pending");

    pendingAppends[1]!.resolve();
    await vi.waitFor(() => expect(collaborativeDocument.getState().persistence).toBe("clean"));
    await closeAll(collaborativeDocument, engine);
    await hub.close();
  });

  it("bounds pending Store operations and reconciles updates omitted after backpressure", async () => {
    const hub = createAssessmentProviderHub();
    const generation = "bounded-store-operations";
    let sequence = 0;
    let deferAppends = false;
    const pendingAppends: Array<{ resolve(): void }> = [];
    const pendingSnapshots: Array<{ resolve(): void }> = [];
    const snapshots: Uint8Array[] = [];
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence } }),
          append: async () => {
            sequence += 1;
            if (deferAppends) {
              await new Promise<void>((resolve) => pendingAppends.push({ resolve }));
            }
            return { generation, sequence };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async (update: Uint8Array) => {
            snapshots.push(new Uint8Array(update));
            await new Promise<void>((resolve) => pendingSnapshots.push({ resolve }));
            return { generation, sequence };
          },
          close: async () => undefined,
        };
      },
    };
    const engine = createCollaborationEngine({
      providers: hub.factory,
      store,
      storeBackpressure: { maxPendingOperations: 2, maxPendingBytes: 1_000_000 },
    });
    const collaborativeDocument = await engine.create(ref(), { initialMarkdown: "a" });
    deferAppends = true;

    for (const markdown of ["ab", "abc", "abcd"]) {
      const current = collaborativeDocument.getMarkdownSnapshot();
      if (!current) throw new Error("expected an open Collaborative Document");
      await collaborativeDocument.replaceMarkdown(markdown, {
        origin: "external-file",
        expectedRevision: current.revision,
      });
    }
    await vi.waitFor(() => expect(pendingAppends).toHaveLength(1));

    expect(collaborativeDocument.getState()).toMatchObject({
      persistence: "failed",
      diagnostic: { code: "store-failed", cause: { code: "store-backpressure" } },
    });
    pendingAppends[0]!.resolve();
    await vi.waitFor(() => expect(pendingAppends).toHaveLength(2));
    pendingAppends[1]!.resolve();

    const recovery = collaborativeDocument.reconcilePersistence();
    await vi.waitFor(() => expect(pendingSnapshots).toHaveLength(1));
    const duringRecovery = collaborativeDocument.getMarkdownSnapshot();
    if (!duringRecovery) throw new Error("expected an open Collaborative Document");
    await collaborativeDocument.replaceMarkdown("abcde", {
      origin: "external-file",
      expectedRevision: duringRecovery.revision,
    });
    pendingSnapshots[0]!.resolve();
    await vi.waitFor(() => expect(pendingSnapshots).toHaveLength(2));
    pendingSnapshots[1]!.resolve();
    await recovery;

    expect(pendingAppends).toHaveLength(2);
    expect(snapshots).toHaveLength(2);
    expect(collaborativeDocument.getState()).toMatchObject({ persistence: "clean", diagnostic: undefined });
    await closeAll(collaborativeDocument, engine);
    await hub.close();
  });

  it("does not retain a single Store update beyond the pending byte ceiling", async () => {
    const hub = createAssessmentProviderHub();
    const generation = "bounded-store-bytes";
    let sequence = 0;
    let runtimeAppends = 0;
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence } }),
          append: async () => {
            sequence += 1;
            runtimeAppends += 1;
            return { generation, sequence };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation, sequence }),
          close: async () => undefined,
        };
      },
    };
    const engine = createCollaborationEngine({
      providers: hub.factory,
      store,
      storeBackpressure: { maxPendingOperations: 32, maxPendingBytes: 1_024 },
    });
    const collaborativeDocument = await engine.create(ref(), { initialMarkdown: "" });
    runtimeAppends = 0;
    const current = collaborativeDocument.getMarkdownSnapshot();
    if (!current) throw new Error("expected an open Collaborative Document");
    await collaborativeDocument.replaceMarkdown("x".repeat(4_096), {
      origin: "external-file",
      expectedRevision: current.revision,
    });

    expect(runtimeAppends).toBe(0);
    expect(collaborativeDocument.getState()).toMatchObject({
      persistence: "failed",
      diagnostic: { cause: { code: "store-backpressure" } },
    });
    await collaborativeDocument.reconcilePersistence();
    await closeAll(collaborativeDocument, engine);
    await hub.close();
  });

  it("opens a valid restored Replica for local-only editing while initial network sync is offline", async () => {
    const hub = createAssessmentProviderHub();
    const store = createAssessmentMemoryStore();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store });
    const created = await firstEngine.create(ref(), { initialMarkdown: "restored" });
    await closeAll(created, firstEngine);
    hub.setOnline(false);

    const offlineFactory = {
      async prepare(context: Parameters<typeof hub.factory.prepare>[0]) {
        const lease = await hub.factory.prepare(context);
        const offlineState = () => ({
          ...lease.getState(),
          authentication: "authenticating" as const,
          access: "none" as const,
        });
        return {
          start: () => lease.start(),
          getState: offlineState,
          subscribe(listener: Parameters<typeof lease.subscribe>[0]) {
            return lease.subscribe(() => listener(offlineState()));
          },
          release: () => lease.release(),
        };
      },
    };
    const offlineEngine = createCollaborationEngine({ providers: offlineFactory, store });
    const opening = offlineEngine.open(ref());
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("restored Replica remained behind initial sync")), 100);
    });
    const restored = await Promise.race([opening, timeout]);
    expect(restored.getState()).toMatchObject({
      lifecycle: "open",
      transport: "offline",
      sync: "stale",
      authentication: "authenticating",
      access: "local-only",
      persistence: "clean",
    });
    const target = editor("restored");
    const binding = await restored.attach(target.editor, { content: "require-match" });
    expect(target.editor.dispatchTransaction({
      changes: [{ from: 8, to: 8, insert: " offline" }],
      origin: ["offline-local"],
    })).toMatchObject({ status: "success" });
    expect(restored.getMarkdown()).toBe("restored offline");

    const reader = editor("restored offline");
    const readerBinding = await restored.attach(reader.editor, {
      content: "require-match",
      access: "read-only",
    });
    expect(reader.editor.dispatchTransaction({
      changes: [{ from: 16, to: 16, insert: " blocked" }],
      origin: ["offline-reader"],
    })).toMatchObject({ status: "rejected", reason: "collaboration-read-only" });
    expect(reader.editor.getDocument()).toBe("restored offline");
    expect(restored.getMarkdown()).toBe("restored offline");

    await readerBinding.detach();
    await binding.detach();
    reader.editor.destroy();
    target.editor.destroy();
    reader.container.remove();
    target.container.remove();
    await closeAll(restored, offlineEngine);
    await store.close();
    await hub.close();
  });

  it("fails a strict open closed without releasing an existing local-authority handle", async () => {
    const seedHub = createAssessmentProviderHub();
    const store = createAssessmentMemoryStore();
    const seedEngine = createCollaborationEngine({ providers: seedHub.factory, store });
    const seeded = await seedEngine.create(ref(), { initialMarkdown: "trusted local cache" });
    await closeAll(seeded, seedEngine);
    await seedHub.close();

    let rejectStart!: (cause: unknown) => void;
    let releaseCount = 0;
    let state: ProviderState = {
      transport: "connecting",
      sync: "syncing",
      authentication: "authenticating",
      access: "none",
    };
    const listeners = new Set<(next: ProviderState) => void>();
    const startGate = new Promise<void>((_resolve, reject) => { rejectStart = reject; });
    const providers: CollaborationProviderFactory = {
      async prepare() {
        return {
          start: () => startGate,
          getState: () => state,
          subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          async release() { releaseCount += 1; },
        };
      },
    };
    const engine = createCollaborationEngine({ providers, store });
    const localFirst = await engine.open(ref());
    const strictOpen = engine.open(ref(), { readiness: "require-authenticated-sync" });
    await expect(strictOpen).rejects.toMatchObject({ code: "remote-authority-unavailable" });
    expect(localFirst.getMarkdown()).toBe("trusted local cache");
    state = {
      transport: "offline",
      sync: "failed",
      authentication: "denied",
      access: "none",
      diagnostic: {
        code: "authentication-denied",
        message: "Credential was denied",
        documentId: ref().id,
      },
    };
    for (const listener of listeners) listener(state);
    rejectStart(new CollaborationError("authentication-denied", "Credential was denied"));

    expect(localFirst.closed).toBe(false);
    expect(localFirst.getMarkdown()).toBe("trusted local cache");
    expect(engine.list()).toHaveLength(1);
    expect(releaseCount).toBe(0);

    await localFirst.close();
    expect(releaseCount).toBe(1);
    await engine.close();
    await store.close();
  });

  it("does not reuse a locally created Replica as remote authority for a strict open", async () => {
    let releaseCount = 0;
    const state: ProviderState = {
      transport: "online",
      sync: "synced",
      authentication: "authenticated",
      access: "read-write",
    };
    const providers: CollaborationProviderFactory = {
      async prepare() {
        return {
          async start() {},
          getState: () => state,
          subscribe: () => () => undefined,
          async release() { releaseCount += 1; },
        };
      },
    };
    const document = ref("document-local-create-provenance");
    const engine = createCollaborationEngine({ providers, store: { mode: "volatile" } });
    const created = await engine.create(document, { initialMarkdown: "locally created" });

    await expect(engine.open(
      document,
      { readiness: "require-authenticated-sync" },
    )).rejects.toMatchObject({ code: "remote-authority-unavailable" });
    expect(created.closed).toBe(false);
    expect(created.getMarkdown()).toBe("locally created");
    expect(releaseCount).toBe(0);

    await created.close();
    expect(releaseCount).toBe(1);
    await engine.close();
  });

  it("preserves the stable opening error when initialization cleanup also fails", async () => {
    const openingFailure = new CollaborationError("authentication-denied", "Credential was denied");
    const releaseFailure = new Error("Provider release failed");
    const state: ProviderState = {
      transport: "failed",
      sync: "failed",
      authentication: "denied",
      access: "none",
      diagnostic: {
        code: "authentication-denied",
        message: "Credential was denied",
        documentId: ref().id,
      },
    };
    const providers: CollaborationProviderFactory = {
      async prepare() {
        return {
          async start() { throw openingFailure; },
          getState: () => state,
          subscribe: () => () => undefined,
          async release() { throw releaseFailure; },
        };
      },
    };
    const engine = createCollaborationEngine({ providers, store: { mode: "volatile" } });

    const failure = await engine.open(
      ref(),
      { readiness: "require-authenticated-sync" },
    ).then(
      () => undefined,
      (cause) => cause as CollaborationError,
    );

    expect(failure).toMatchObject({
      code: "authentication-denied",
      message: "Credential was denied",
    });
    expect(failure?.cause).toBeInstanceOf(AggregateError);
    expect((failure?.cause as AggregateError).errors).toEqual([openingFailure, releaseFailure]);
    expect(engine.list()).toHaveLength(0);
    await engine.close();
  });

  it("reports a later Store append failure without claiming clean persistence", async () => {
    const hub = createAssessmentProviderHub();
    let appends = 0;
    let closes = 0;
    let flushes = 0;
    const generation = "failure-test-generation";
    const appendFailure = new Error("injected append failure");
    const flushFailure = new Error("injected flush failure");
    const closeFailure = new Error("injected close failure");
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence: 0 } }),
          append: async () => {
            appends += 1;
            if (appends > 1) throw appendFailure;
            return { generation, sequence: appends };
          },
          flush: async () => {
            flushes += 1;
            if (flushes > 1) throw flushFailure;
          },
          replaceWithSnapshot: async () => ({ generation, sequence: appends }),
          close: async () => {
            closes += 1;
            throw closeFailure;
          },
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
    const closeError = await document.close().then(
      () => undefined,
      (cause) => cause as CollaborationError,
    );
    expect(closeError).toMatchObject({ code: "store-failed" });
    expect(closeError?.cause).toBeInstanceOf(AggregateError);
    expect((closeError?.cause as AggregateError).errors).toEqual([
      appendFailure,
      flushFailure,
      closeFailure,
    ]);
    expect({ closes, flushes }).toEqual({ closes: 1, flushes: 2 });
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });
    await engine.close();
    await hub.close();
  });

  it("reconciles an ambiguously committed Store append after the durable worker reconnects", async () => {
    const hub = createAssessmentProviderHub();
    const backing = createAssessmentMemoryStore();
    const replyLost = Object.assign(
      new Error("worker restarted after commit before reply"),
      { code: "store-request-timeout" },
    );
    const unavailable = new Error("durable worker is unavailable");
    let online = true;
    let failAfterCommit = false;
    let replacements = 0;
    const store = {
      async open(documentId: ReturnType<typeof asDocumentId>) {
        const lease = await backing.open(documentId);
        return {
          async load() {
            if (!online) throw unavailable;
            return lease.load();
          },
          async append(update: Uint8Array) {
            if (!online) throw unavailable;
            const checkpoint = await lease.append(update);
            if (failAfterCommit) {
              failAfterCommit = false;
              online = false;
              throw replyLost;
            }
            return checkpoint;
          },
          async flush() {
            if (!online) throw unavailable;
            await lease.flush();
          },
          async replaceWithSnapshot(
            update: Uint8Array,
            options: Parameters<typeof lease.replaceWithSnapshot>[1],
          ) {
            if (!online) throw unavailable;
            replacements += 1;
            return lease.replaceWithSnapshot(update, options);
          },
          close: () => lease.close(),
        };
      },
    };
    const engine = createCollaborationEngine({ providers: hub.factory, store });
    const document = await engine.create(ref(), { initialMarkdown: "a" });
    const target = editor("a");
    const binding = await document.attach(target.editor, { content: "require-match" });

    failAfterCommit = true;
    target.editor.dispatchTransaction({
      changes: [{ from: 1, to: 1, insert: "b" }],
      origin: ["ambiguous-durability-test"],
    });
    await vi.waitFor(() => expect(document.getState().persistence).toBe("failed"));
    expect(document.getState().diagnostic?.cause).toBe(replyLost);
    expect(document.getMarkdown()).toBe("ab");

    await expect(document.reconcilePersistence()).rejects.toMatchObject({
      code: "store-failed",
      cause: unavailable,
    });
    expect(document.getState().persistence).toBe("failed");

    online = true;
    const firstRecovery = document.reconcilePersistence();
    const concurrentRecovery = document.reconcilePersistence();
    expect(concurrentRecovery).toBe(firstRecovery);
    await firstRecovery;
    expect(replacements).toBe(1);
    expect(document.getState()).toMatchObject({ persistence: "clean", diagnostic: undefined });

    await binding.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);

    const reopenedEngine = createCollaborationEngine({ providers: hub.factory, store });
    const reopened = await reopenedEngine.open(ref());
    expect(reopened.getMarkdown()).toBe("ab");
    await closeAll(reopened, reopenedEngine);
    await backing.close();
    await hub.close();
  });

  it("keeps persistence pending when an update is queued during reconciliation", async () => {
    const hub = createAssessmentProviderHub();
    const appendFailure = new Error("injected transient append failure");
    const generation = "concurrent-reconciliation-generation";
    let sequence = 0;
    let failNextAppend = false;
    let snapshotCalls = 0;
    const pendingSnapshots: Array<{ resolve(): void }> = [];
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence } }),
          append: async () => {
            if (failNextAppend) {
              failNextAppend = false;
              throw appendFailure;
            }
            sequence += 1;
            return { generation, sequence };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => {
            snapshotCalls += 1;
            await new Promise<void>((resolve) => pendingSnapshots.push({ resolve }));
            return { generation, sequence };
          },
          close: async () => undefined,
        };
      },
    };
    const engine = createCollaborationEngine({ providers: hub.factory, store });
    const collaborativeDocument = await engine.create(ref(), { initialMarkdown: "a" });

    failNextAppend = true;
    const beforeFailure = collaborativeDocument.getMarkdownSnapshot();
    if (!beforeFailure) throw new Error("expected an open Collaborative Document");
    await collaborativeDocument.replaceMarkdown("ab", {
      origin: "external-file",
      expectedRevision: beforeFailure.revision,
    });
    await vi.waitFor(() => expect(collaborativeDocument.getState().persistence).toBe("failed"));

    const recovery = collaborativeDocument.reconcilePersistence();
    await vi.waitFor(() => expect(snapshotCalls).toBe(1));
    const duringRecovery = collaborativeDocument.getMarkdownSnapshot();
    if (!duringRecovery) throw new Error("expected an open Collaborative Document");
    await collaborativeDocument.replaceMarkdown("abc", {
      origin: "external-file",
      expectedRevision: duringRecovery.revision,
    });
    pendingSnapshots[0]!.resolve();
    await vi.waitFor(() => expect(snapshotCalls).toBe(2));
    expect(collaborativeDocument.getState().persistence).toBe("pending");
    pendingSnapshots[1]!.resolve();
    await recovery;
    expect(collaborativeDocument.getState().persistence).toBe("clean");

    await closeAll(collaborativeDocument, engine);
    await hub.close();
  });

  it("does not report clean while initial Provider state is still pending durability", async () => {
    const source = new Y.Doc();
    const sourceMeta = source.getMap("nexus:meta");
    source.transact(() => {
      sourceMeta.set("schemaVersion", 1);
      sourceMeta.set("documentId", ref().id);
      sourceMeta.set("hostIdentity", ref().hostIdentity);
      sourceMeta.set("created", true);
      sourceMeta.set("createdAt", "2026-09-03T00:00:00.000Z");
      source.getText("content").insert(0, "remote");
    });
    const remoteUpdate = Y.encodeStateAsUpdate(source);
    let releaseAppend!: () => void;
    const appendGate = new Promise<void>((resolve) => { releaseAppend = resolve; });
    const providers = {
      async prepare(context: Parameters<ReturnType<typeof createAssessmentProviderHub>["factory"]["prepare"]>[0]) {
        const state = {
          transport: "online" as const,
          sync: "synced" as const,
          authentication: "authenticated" as const,
          access: "read-write" as const,
        };
        return {
          async start() { context.replica.applyUpdate(remoteUpdate); },
          getState: () => state,
          subscribe: () => () => undefined,
          release: async () => undefined,
        };
      },
    };
    const generation = "initial-provider-persistence";
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence: 0 } }),
          append: async () => {
            await appendGate;
            return { generation, sequence: 1 };
          },
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation, sequence: 1 }),
          close: async () => undefined,
        };
      },
    };
    const engine = createCollaborationEngine({ providers, store });
    const collaborativeDocument = await engine.open(ref());

    expect(collaborativeDocument.getMarkdown()).toBe("remote");
    expect(collaborativeDocument.getState().persistence).toBe("pending");
    releaseAppend();
    await vi.waitFor(() => expect(collaborativeDocument.getState().persistence).toBe("clean"));

    await closeAll(collaborativeDocument, engine);
    source.destroy();
  });

  it("returns a close-time flush failure after still closing the Store and Provider", async () => {
    const hub = createAssessmentProviderHub();
    const flushFailure = new Error("injected close-time flush failure");
    const storeCloseFailure = new Error("injected close failure after flush failure");
    let sequence = 0;
    let flushes = 0;
    let closes = 0;
    const generation = "flush-failure-generation";
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence } }),
          append: async () => ({ generation, sequence: ++sequence }),
          flush: async () => {
            flushes += 1;
            if (flushes > 1) throw flushFailure;
          },
          replaceWithSnapshot: async () => ({ generation, sequence }),
          close: async () => {
            closes += 1;
            throw storeCloseFailure;
          },
        };
      },
    };
    const engine = createCollaborationEngine({ providers: hub.factory, store });
    const document = await engine.create(ref(), { initialMarkdown: "durable" });

    const closeError = await document.close().then(
      () => undefined,
      (cause) => cause as CollaborationError,
    );
    expect(closeError).toMatchObject({ code: "store-failed" });
    expect(closeError?.cause).toBeInstanceOf(AggregateError);
    expect((closeError?.cause as AggregateError).errors).toEqual([flushFailure, storeCloseFailure]);
    expect(document.closed).toBe(true);
    expect({ closes, flushes }).toEqual({ closes: 1, flushes: 2 });
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });

    await engine.close();
    await hub.close();
  });

  it("attempts Provider, Store, Awareness, and Y.Doc cleanup when every boundary fails", async () => {
    const hub = createAssessmentProviderHub();
    const providerFailure = new Error("provider release failed");
    const flushFailure = new Error("store flush failed");
    const storeCloseFailure = new Error("store close failed");
    const awarenessFailure = new Error("awareness destroy failed");
    const documentFailure = new Error("Y.Doc destroy failed");
    let providerReleases = 0;
    let sequence = 0;
    let flushes = 0;
    let storeCloses = 0;
    const generation = "cleanup-boundary-generation";
    const providers = {
      async prepare(context: Parameters<typeof hub.factory.prepare>[0]) {
        const lease = await hub.factory.prepare(context);
        return {
          start: () => lease.start(),
          getState: () => lease.getState(),
          subscribe: (listener: Parameters<typeof lease.subscribe>[0]) => lease.subscribe(listener),
          async release() {
            providerReleases += 1;
            await lease.release();
            throw providerFailure;
          },
        };
      },
    };
    const store = {
      async open() {
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence } }),
          append: async () => ({ generation, sequence: ++sequence }),
          async flush() {
            flushes += 1;
            if (flushes > 1) throw flushFailure;
          },
          replaceWithSnapshot: async () => ({ generation, sequence }),
          async close() {
            storeCloses += 1;
            throw storeCloseFailure;
          },
        };
      },
    };
    const engine = createCollaborationEngine({ providers, store });
    const document = await engine.create(ref(), { initialMarkdown: "durable" });
    const originalAwarenessDestroy = Awareness.prototype.destroy;
    const originalDocumentDestroy = Y.Doc.prototype.destroy;
    let awarenessDestroys = 0;
    let documentDestroys = 0;
    const awarenessSpy = vi.spyOn(Awareness.prototype, "destroy").mockImplementation(function (this: Awareness) {
      awarenessDestroys += 1;
      originalAwarenessDestroy.call(this);
      if (awarenessDestroys === 1) throw awarenessFailure;
    });
    const documentSpy = vi.spyOn(Y.Doc.prototype, "destroy").mockImplementation(function (this: Y.Doc) {
      documentDestroys += 1;
      originalDocumentDestroy.call(this);
      throw documentFailure;
    });

    const close = document.close();
    const closeResult = await Promise.allSettled([close]);
    awarenessSpy.mockRestore();
    documentSpy.mockRestore();

    expect(closeResult[0]?.status).toBe("rejected");
    if (closeResult[0]?.status === "rejected") {
      expect(closeResult[0].reason).toBeInstanceOf(AggregateError);
      const errors = (closeResult[0].reason as AggregateError).errors;
      expect(errors).toContain(providerFailure);
      expect(errors).toContain(awarenessFailure);
      expect(errors).toContain(documentFailure);
      const storeError = errors.find(
        (error) => error instanceof CollaborationError && error.code === "store-failed",
      ) as CollaborationError | undefined;
      expect(storeError?.cause).toBeInstanceOf(AggregateError);
      expect((storeError?.cause as AggregateError).errors).toEqual([flushFailure, storeCloseFailure]);
    }
    expect({ providerReleases, flushes, storeCloses, awarenessDestroys, documentDestroys }).toEqual({
      providerReleases: 1,
      flushes: 2,
      storeCloses: 1,
      awarenessDestroys: 2,
      documentDestroys: 1,
    });
    expect(document.closed).toBe(true);
    expect(engine.list()).toHaveLength(0);
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });

    await engine.close();
    await hub.close();
  });

  it("shares concurrent Engine close work and reports every Replica cleanup failure", async () => {
    const hub = createAssessmentProviderHub();
    const firstRef = ref("018f1f42-4bea-7a11-b6aa-9e922f009711");
    const secondRef = ref("018f1f42-4bea-7a11-b6aa-9e922f009712");
    const failures = new Map([
      [firstRef.id, new Error("first Replica Store close failed")],
      [secondRef.id, new Error("second Replica Store close failed")],
    ]);
    const closeCalls: string[] = [];
    const store = {
      async open(documentId: ReturnType<typeof asDocumentId>) {
        let sequence = 0;
        const generation = `generation-${documentId}`;
        return {
          load: async () => ({ updates: [], checkpoint: { generation, sequence } }),
          append: async () => ({ generation, sequence: ++sequence }),
          flush: async () => undefined,
          replaceWithSnapshot: async () => ({ generation, sequence }),
          close: async () => {
            closeCalls.push(documentId);
            throw failures.get(documentId);
          },
        };
      },
    };
    const engine = createCollaborationEngine({ providers: hub.factory, store });
    const firstDocument = await engine.create(firstRef, { initialMarkdown: "first" });
    const secondDocument = await engine.create(secondRef, { initialMarkdown: "second" });

    const firstClose = engine.close();
    const concurrentClose = engine.close();
    expect(concurrentClose).toBe(firstClose);
    const [firstResult, concurrentResult] = await Promise.allSettled([firstClose, concurrentClose]);

    expect(firstResult.status).toBe("rejected");
    expect(concurrentResult.status).toBe("rejected");
    if (firstResult.status === "rejected") {
      expect(firstResult.reason).toBeInstanceOf(AggregateError);
      const errors = (firstResult.reason as AggregateError).errors;
      expect(errors).toHaveLength(2);
      expect(errors.every((error) => error instanceof CollaborationError && error.code === "store-failed")).toBe(true);
    }
    if (firstResult.status === "rejected" && concurrentResult.status === "rejected") {
      expect(concurrentResult.reason).toBe(firstResult.reason);
    }
    expect(closeCalls).toEqual(expect.arrayContaining([firstRef.id, secondRef.id]));
    expect(closeCalls).toHaveLength(2);
    expect(firstDocument.closed).toBe(true);
    expect(secondDocument.closed).toBe(true);
    expect(hub.inspect()).toEqual({ rooms: 0, participants: 0, queuedUpdates: 0 });
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

    expect(first.getState().peers.some((item) => item.userId === "user-1")).toBe(false);
    const peer = second.getState().peers.find((item) => item.userId === "user-1");
    expect(peer).toBeDefined();
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

  it("rejects local proposals until an Editor binding is fully ready", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "hello" });
    const target = editor("hello");

    const attaching = document.attach(target.editor, { content: "require-match" });
    const premature = target.editor.dispatchTransaction({
      changes: [{ from: 5, to: 5, insert: "!" }],
      origin: ["attach-race"],
    });

    expect(premature).toMatchObject({
      status: "rejected",
      reason: "collaboration-binding-not-ready",
    });
    expect(target.editor.getDocument()).toBe("hello");
    expect(document.getMarkdown()).toBe("hello");

    const binding = await attaching;
    expect(target.editor.dispatchTransaction({
      changes: [{ from: 5, to: 5, insert: "!" }],
      origin: ["after-attach"],
    }).status).toBe("success");
    expect(document.getMarkdown()).toBe("hello!");

    await binding.detach();
    target.editor.destroy();
    target.container.remove();
    await closeAll(document, engine);
    await hub.close();
  });

  it("projects the current Replica when a remote update arrives during Editor attach", async () => {
    const hub = createAssessmentProviderHub();
    const localEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const remoteEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const localDocument = await localEngine.create(ref(), { initialMarkdown: "hello" });
    const remoteDocument = await remoteEngine.open(ref());
    const local = editor("hello");
    const remote = editor("hello");
    const remoteBinding = await remoteDocument.attach(remote.editor, { content: "require-match" });

    const attaching = localDocument.attach(local.editor, { content: "require-match" });
    expect(remote.editor.dispatchTransaction({
      changes: [{ from: 5, to: 5, insert: "!" }],
      origin: ["remote-during-attach"],
    }).status).toBe("success");
    const localBinding = await attaching;

    expect(localDocument.getMarkdown()).toBe("hello!");
    expect(local.editor.getDocument()).toBe("hello!");
    expect(localDocument.getState().consistency).toBe("healthy");

    await localBinding.detach();
    await remoteBinding.detach();
    local.editor.destroy();
    remote.editor.destroy();
    local.container.remove();
    remote.container.remove();
    await closeAll(localDocument, remoteDocument, localEngine, remoteEngine);
    await hub.close();
  });

  it("rolls back an Editor binding when its document closes during attach", async () => {
    const hub = createAssessmentProviderHub();
    const engine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const document = await engine.create(ref(), { initialMarkdown: "hello" });
    const target = editor("hello");

    const attaching = document.attach(target.editor, { content: "require-match" });
    const closing = document.close();

    await expect(attaching).rejects.toMatchObject({ code: "handle-closed" });
    await expect(closing).resolves.toBeUndefined();
    expect(document.closed).toBe(true);
    expect(target.editor.dispatchTransaction({
      changes: [{ from: 5, to: 5, insert: "!" }],
      origin: ["after-close"],
    }).status).toBe("success");

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
