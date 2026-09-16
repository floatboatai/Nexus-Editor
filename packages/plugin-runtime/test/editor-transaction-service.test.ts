import {
  EDITOR_TRANSACTIONS_CAPABILITY,
  NexusPluginBase,
  type AuthorPluginManifest,
  type ComponentId,
  type EditorContext,
  type EditorTransaction,
  type EditorTransactionContext,
  type EditorTransactionService,
  type EditorUpdateContext,
  type ManagedResource,
  type NexusDiagnostic,
  type PluginId,
  type ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import {
  createEditor,
  type EditorAPI,
  type EditorContributionRegistration,
} from "@floatboat/nexus-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RuntimeCapabilityRegistry } from "../src/capability";
import { PluginCompatibilityValidator } from "../src/compatibility";
import { EditorHostRegistry } from "../src/editor-host-registry";
import { EditorTransactionPipeline } from "../src/index";
import {
  HostControlledPluginEntrypointLoader,
  TrustedPluginPackageLoader,
} from "../src/loader";
import { PluginManager } from "../src/plugin-manager";

const liveEditors: Array<{ readonly editor: EditorAPI; readonly container: HTMLElement }> = [];

function attachRealEditor(initialValue: string, editorIdPrefix = "test-editor") {
  const container = document.createElement("div");
  document.body.append(container);
  const editor = createEditor({ container, initialValue });
  const registry = new EditorHostRegistry({ editorIdPrefix });
  const attachment = registry.attach({
    editor,
    surface: { kind: "document", id: "test-surface", root: container },
  });
  liveEditors.push({ editor, container });
  return { container, editor, registry, attachment };
}

function owner(id = "transactions-fixture"): ResourceOwner {
  return { pluginId: id as PluginId, componentId: (id + ":root") as ComponentId };
}

/** 与 component-controller 同形的“资源树”替身：只做 register + activate（不是假 sink，也不替换任何实现）。 */
function createResourceCollector() {
  const resources: Array<ManagedResource> = [];
  return {
    resources,
    register: (resource: ManagedResource) => {
      resources.push(resource);
    },
    activate: () => Promise.all(resources.map((resource) => resource.activate?.())),
    dispose: () => Promise.all(resources.map((resource) => resource.dispose())),
  };
}

function createPipeline(
  attachment: { readonly context: EditorContext },
  reportDiagnostic?: (diagnostic: NexusDiagnostic) => void,
) {
  return new EditorTransactionPipeline({
    context: () => attachment.context,
    ...(reportDiagnostic ? { reportDiagnostic } : {}),
  });
}

function transaction(overrides: Partial<EditorTransaction> = {}): EditorTransaction {
  return {
    changes: [{ from: 0, to: 0, insert: "X" }],
    selectionBefore: { ranges: [{ anchor: 0, head: 0 }], mainIndex: 0 },
    selectionAfter: { ranges: [{ anchor: 1, head: 1 }], mainIndex: 0 },
    origin: [],
    ...overrides,
  };
}

afterEach(() => {
  for (const { editor, container } of liveEditors.splice(0)) {
    editor.destroy();
    container.remove();
  }
  document.body.replaceChildren();
});

describe("EditorTransactionPipeline", () => {
  it("introduces no transaction hook of its own", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const sink = editor.getContributionSink();
    const registerFilter = vi.spyOn(sink, "registerTransactionFilter");
    const registerListener = vi.spyOn(sink, "registerUpdateListener");
    const pipeline = createPipeline(attachment);

    expect(registerFilter).not.toHaveBeenCalled();
    expect(registerListener).not.toHaveBeenCalled();

    editor.replaceRange(0, 0, "X");
    expect(editor.getDocument()).toBe("Xalpha");

    await pipeline.dispose();

    expect(registerFilter).not.toHaveBeenCalled();
    expect(registerListener).not.toHaveBeenCalled();
  });

  it("keeps registered hooks staged until activation", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const seen: string[] = [];

    const result = service.registerFilter((context) => {
      seen.push(context.transaction.changes.map((change) => change.insert).join(""));
      return { action: "accept" };
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("filter registration failed");
    const registration = result.registration;
    expect(registration.state).toBe("staged");
    expect(registration.localId).toBe("transaction-filter-1");
    expect(registration.globalId).toBe("transactions-fixture:transaction-filter-1");
    expect(registration.priority).toBe(0);

    editor.replaceRange(5, 5, "X");
    expect(seen).toEqual([]);
    expect(editor.getDocument()).toBe("alphaX");

    await collector.activate();
    expect(registration.state).toBe("active");
    editor.replaceRange(6, 6, "Y");
    expect(seen).toEqual(["Y"]);
    expect(editor.getDocument()).toBe("alphaXY");

    await registration.dispose();
    expect(registration.disposed).toBe(true);
    expect(registration.state).toBe("disposed");
    editor.replaceRange(7, 7, "Z");
    expect(seen).toEqual(["Y"]);
    expect(editor.getDocument()).toBe("alphaXYZ");
  });

  it("applies an accepted transaction and separates filter and listener views", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const filterDocuments: string[] = [];
    const filterTransactions: EditorTransaction[] = [];
    const updates: EditorUpdateContext[] = [];
    const listenerDocuments: string[] = [];

    const filterResult = service.registerFilter((context) => {
      filterDocuments.push(context.editor.getDocument());
      filterTransactions.push(context.transaction);
      return { action: "accept" };
    });
    expect(filterResult.ok).toBe(true);
    const listenerResult = service.registerUpdateListener((update) => {
      updates.push(update);
      listenerDocuments.push(update.editor.getDocument());
    });
    expect(listenerResult.ok).toBe(true);
    await collector.activate();

    editor.replaceRange(0, 0, "X", { anchor: 1, head: 1 });

    expect(editor.getDocument()).toBe("Xalpha");
    expect(filterDocuments).toEqual(["alpha"]);
    expect(filterTransactions).toHaveLength(1);
    const transaction = filterTransactions[0]!;
    expect(transaction.changes).toStrictEqual([{ from: 0, to: 0, insert: "X" }]);
    expect(transaction.selectionBefore).toStrictEqual({
      ranges: [{ anchor: 0, head: 0 }],
      mainIndex: 0,
    });
    expect(transaction.selectionAfter).toStrictEqual({
      ranges: [{ anchor: 1, head: 1 }],
      mainIndex: 0,
    });
    expect(Array.isArray(transaction.origin)).toBe(true);

    expect(updates).toHaveLength(1);
    const update = updates[0]!;
    expect(update.documentBefore).toBe("alpha");
    expect(update.documentAfter).toBe("Xalpha");
    expect(listenerDocuments).toEqual(["Xalpha"]);
  });

  it("rejects a transaction and surfaces the diagnostic", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const supplied: NexusDiagnostic = {
      code: "command-invalid",
      severity: "warning",
      phase: "validation",
      message: "Filter refused this edit",
    };
    let behavior: "reject" | "diagnostic" = "reject";
    const filterResult = service.registerFilter(() =>
      behavior === "reject" ? { action: "reject" } : { action: "reject", diagnostic: supplied },
    );
    expect(filterResult.ok).toBe(true);
    await collector.activate();

    const documentBefore = editor.getDocument();
    const selectionBefore = editor.getSelections();

    const first = service.dispatch(attachment.editorId, transaction());
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error("dispatch unexpectedly succeeded");
    expect(first.diagnostic.code).toBe("unsupported-operation");
    expect(first.diagnostic.message).toBe("Transaction rejected by a plugin filter");
    expect(first.diagnostic.resourceId).toBe("transactions-fixture");
    expect(editor.getDocument()).toBe(documentBefore);
    expect(editor.getSelections()).toStrictEqual(selectionBefore);

    behavior = "diagnostic";
    const second = service.dispatch(attachment.editorId, transaction());
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("dispatch unexpectedly succeeded");
    expect(second.diagnostic).toBe(supplied);
    expect(second.diagnostic.code).toBe("command-invalid");
    expect(second.diagnostic.severity).toBe("warning");
    expect(second.diagnostic.phase).toBe("validation");
    expect(second.diagnostic.plugin).toStrictEqual({
      id: "transactions-fixture",
      version: "unknown",
    });
    expect(editor.getDocument()).toBe(documentBefore);
    // A failure is handed back to the caller, not re-reported as a diagnostic.
    expect(diagnostics).toEqual([]);
  });

  it("applies a replaced transaction atomically and notifies once", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const seenByLowerPriority: unknown[] = [];
    const updates: EditorUpdateContext[] = [];

    const higher = service.registerFilter(
      (context) => ({
        action: "replace",
        transaction: { ...context.transaction, changes: [{ from: 0, to: 0, insert: "A" }] },
      }),
      { priority: 10 },
    );
    expect(higher.ok).toBe(true);
    const lower = service.registerFilter((context) => {
      seenByLowerPriority.push(context.transaction.changes);
      return {
        action: "replace",
        transaction: {
          ...context.transaction,
          changes: [...context.transaction.changes, { from: 5, to: 5, insert: "!" }],
        },
      };
    });
    expect(lower.ok).toBe(true);
    const listener = service.registerUpdateListener((update) => updates.push(update));
    expect(listener.ok).toBe(true);
    await collector.activate();

    const result = service.dispatch(attachment.editorId, transaction());

    expect(result.ok).toBe(true);
    expect(editor.getDocument()).toBe("Aalpha!");
    // The lower-priority filter sees the already replaced changeset, not the original one.
    expect(seenByLowerPriority).toEqual([[{ from: 0, to: 0, insert: "A" }]]);
    // One commit, one notification: both transformations landed in a single changeset.
    expect(updates).toHaveLength(1);
    const update = updates[0]!;
    expect(update.documentBefore).toBe("alpha");
    expect(update.documentAfter).toBe("Aalpha!");
    expect(update.transaction.changes).toStrictEqual([
      { from: 0, to: 0, insert: "A" },
      { from: 5, to: 5, insert: "!" },
    ]);
  });

  it("bypasses malformed filter output instead of breaking the commit", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const seenByFollowingFilter: string[] = [];
    const updates: EditorUpdateContext[] = [];
    let mode: "invalid" | "async" | "out-of-range" | "empty-selection" = "invalid";

    const malformed = service.registerFilter(
      () => {
        if (mode === "invalid") return undefined as never;
        if (mode === "async") return Promise.resolve({ action: "accept" }) as never;
        if (mode === "out-of-range") {
          return {
            action: "replace",
            transaction: {
              ...transaction(),
              changes: [{ from: 0, to: 9999, insert: "Z" }],
            },
          };
        }
        return {
          action: "replace",
          transaction: { ...transaction(), selectionAfter: { ranges: [], mainIndex: 0 } },
        };
      },
      { priority: 10 },
    );
    expect(malformed.ok).toBe(true);
    const following = service.registerFilter((context) => {
      seenByFollowingFilter.push(context.transaction.changes.map((change) => change.insert).join(""));
      return { action: "accept" };
    });
    expect(following.ok).toBe(true);
    const listener = service.registerUpdateListener((update) => updates.push(update));
    expect(listener.ok).toBe(true);
    await collector.activate();

    const dispatchOnce = (next: typeof mode) => {
      mode = next;
      let result!: ReturnType<typeof service.dispatch>;
      expect(() => {
        result = service.dispatch(attachment.editorId, transaction());
      }).not.toThrow();
      return result;
    };

    const invalid = dispatchOnce("invalid");
    expect(invalid.ok).toBe(true);
    expect(editor.getDocument()).toBe("Xalpha");
    expect(diagnostics.at(-1)).toMatchObject({
      code: "callback-failed",
      phase: "callback",
      severity: "error",
      message: "Editor transaction filter returned an invalid result",
    });

    const asyncResult = dispatchOnce("async");
    expect(asyncResult.ok).toBe(true);
    expect(editor.getDocument()).toBe("XXalpha");
    expect(diagnostics.at(-1)).toMatchObject({
      code: "callback-failed",
      message: "Editor transaction filters must return synchronously",
    });

    const outOfRange = dispatchOnce("out-of-range");
    expect(outOfRange.ok).toBe(true);
    // The malformed replacement is dropped; the caller's own changeset still commits.
    expect(editor.getDocument()).toBe("XXXalpha");
    expect(diagnostics.at(-1)).toMatchObject({
      code: "callback-failed",
      message: "Editor transaction filter returned a transaction that cannot be applied",
    });

    const emptySelection = dispatchOnce("empty-selection");
    expect(emptySelection.ok).toBe(true);
    expect(editor.getDocument()).toBe("XXXXalpha");
    expect(diagnostics.at(-1)).toMatchObject({
      code: "callback-failed",
      message: "Editor transaction filter returned a transaction that cannot be applied",
    });

    expect(seenByFollowingFilter).toEqual(["X", "X", "X", "X"]);
    expect(updates).toHaveLength(4);
  });

  it("reports a throwing filter and keeps the rest of the pipeline working", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const seenByFollowingFilter: string[] = [];
    const updates: EditorUpdateContext[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const throwing = service.registerFilter((context) => {
      if (context.transaction.userEvent === "boom") throw new Error("filter exploded");
      return { action: "accept" };
    });
    expect(throwing.ok).toBe(true);
    const following = service.registerFilter((context) => {
      seenByFollowingFilter.push(context.transaction.changes.map((change) => change.insert).join(""));
      return { action: "accept" };
    });
    expect(following.ok).toBe(true);
    const listener = service.registerUpdateListener((update) => updates.push(update));
    expect(listener.ok).toBe(true);
    await collector.activate();

    const broken = service.dispatch(attachment.editorId, transaction({ userEvent: "boom" }));

    // A faulty filter is bypassed, never translated into a veto.
    expect(broken.ok).toBe(true);
    expect(editor.getDocument()).toBe("Xalpha");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: "callback-failed",
      phase: "callback",
      severity: "error",
      message: "Editor transaction filter failed",
      cause: { name: "Error", message: "filter exploded" },
      plugin: { id: "transactions-fixture", version: "unknown" },
    });
    expect(seenByFollowingFilter).toEqual(["X"]);
    expect(updates).toHaveLength(1);
    // Core's own filter-error veto path stays unreachable for plugin faults.
    expect(consoleError).not.toHaveBeenCalled();

    const normal = service.dispatch(attachment.editorId, transaction());
    expect(normal.ok).toBe(true);
    expect(editor.getDocument()).toBe("XXalpha");
    expect(seenByFollowingFilter).toEqual(["X", "X"]);
    expect(updates).toHaveLength(2);

    // A listener that throws is reported as well; it can neither undo the commit that
    // already landed nor stop the other listeners.
    const throwingListener = service.registerUpdateListener(() => {
      throw new Error("listener exploded");
    });
    expect(throwingListener.ok).toBe(true);
    await collector.activate();

    const withThrowingListener = service.dispatch(attachment.editorId, transaction());
    expect(withThrowingListener.ok).toBe(true);
    expect(editor.getDocument()).toBe("XXXalpha");
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[1]).toMatchObject({
      code: "callback-failed",
      phase: "callback",
      message: "Editor transaction update listener failed",
      cause: { name: "Error", message: "listener exploded" },
      plugin: { id: "transactions-fixture", version: "unknown" },
    });
    expect(seenByFollowingFilter).toEqual(["X", "X", "X"]);
    expect(updates).toHaveLength(3);
    // Core's own filter-error / listener-error paths stay unreachable for plugin faults.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("refuses a dispatch from inside a filter without disturbing the outer commit", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const nestedResults: Array<ReturnType<EditorTransactionService["dispatch"]>> = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let invocations = 0;

    const filter = service.registerFilter(() => {
      // Only the outermost filter pass nests a dispatch, which also bounds the test.
      if (invocations++ === 0) {
        nestedResults.push(service.dispatch(attachment.editorId, transaction()));
      }
      return { action: "accept" };
    });
    expect(filter.ok).toBe(true);
    await collector.activate();

    let outer!: ReturnType<EditorTransactionService["dispatch"]>;
    expect(() => {
      outer = service.dispatch(attachment.editorId, transaction());
    }).not.toThrow();
    expect(outer.ok).toBe(true);
    expect(editor.getDocument()).toBe("Xalpha");
    expect(nestedResults).toHaveLength(1);
    const fromDispatch = nestedResults[0]!;
    expect(fromDispatch.ok).toBe(false);
    if (fromDispatch.ok) throw new Error("nested dispatch unexpectedly succeeded");
    expect(fromDispatch.diagnostic.code).toBe("unsupported-operation");
    expect(fromDispatch.diagnostic.message).toBe(
      "Cannot dispatch a transaction from inside a transaction filter",
    );

    // The same guard has to cover a commit that the user typed, where no dispatch
    // frame exists: without it the outer edit would be silently dropped.
    invocations = 0;
    nestedResults.length = 0;
    expect(() => {
      editor.replaceRange(0, 0, "W");
    }).not.toThrow();
    expect(editor.getDocument()).toBe("WXalpha");
    expect(nestedResults).toHaveLength(1);
    const fromUserEdit = nestedResults[0]!;
    expect(fromUserEdit.ok).toBe(false);
    if (fromUserEdit.ok) throw new Error("nested dispatch unexpectedly succeeded");
    expect(fromUserEdit.diagnostic.code).toBe("unsupported-operation");
    expect(fromUserEdit.diagnostic.message).toBe(
      "Cannot dispatch a transaction from inside a transaction filter",
    );

    // Core's RangeError-driven filter-error path must stay unreachable.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("allows listener dispatches and maps the recursion limit", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const nested: Array<ReturnType<EditorTransactionService["dispatch"]>> = [];
    let notifications = 0;

    const listener = service.registerUpdateListener(() => {
      if (notifications++ === 0) {
        nested.push(
          service.dispatch(
            attachment.editorId,
            transaction({ changes: [{ from: 0, to: 0, insert: "Y" }] }),
          ),
        );
      }
    });
    expect(listener.ok).toBe(true);
    await collector.activate();

    const outer = service.dispatch(attachment.editorId, transaction());
    expect(outer.ok).toBe(true);
    expect(nested).toHaveLength(1);
    expect(nested[0]!.ok).toBe(true);
    // Both commits landed: the listener's commit is not swallowed by the outer one.
    expect(editor.getDocument()).toBe("YXalpha");
    expect(notifications).toBe(2);

    // An unbounded self-dispatching listener is stopped by core's recursion limit and
    // surfaces as an observable failure rather than a stack overflow.
    notifications = 0;
    nested.length = 0;
    const looping = service.registerUpdateListener((update) => {
      if (update.transaction.userEvent !== "loop") return;
      nested.push(
        service.dispatch(attachment.editorId, transaction({ userEvent: "loop" })),
      );
    });
    expect(looping.ok).toBe(true);
    // The collector activates idempotently, so a hook registered after the first
    // activation still gets installed.
    await collector.activate();

    let loopingOuter!: ReturnType<EditorTransactionService["dispatch"]>;
    expect(() => {
      loopingOuter = service.dispatch(attachment.editorId, transaction({ userEvent: "loop" }));
    }).not.toThrow();
    expect(loopingOuter.ok).toBe(true);
    const failures = nested.filter((result) => !result.ok);
    expect(failures).toHaveLength(1);
    const failure = failures[0]!;
    if (failure.ok) throw new Error("recursion limit was not reported");
    expect(failure.diagnostic.code).toBe("unsupported-operation");
    expect(failure.diagnostic.message).toContain("32");
  });

  it("round-trips operationId through filters and listeners", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const other = attachRealEditor("beta", "other-editor");
    const pipeline = createPipeline(attachment);
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const seenByFilter: Array<string | undefined> = [];
    const listenerTransactions: EditorTransaction[] = [];

    const filter = service.registerFilter((context) => {
      seenByFilter.push(context.transaction.operationId);
      return { action: "accept" };
    });
    expect(filter.ok).toBe(true);
    const listener = service.registerUpdateListener((update) => {
      listenerTransactions.push(update.transaction);
    });
    expect(listener.ok).toBe(true);
    await collector.activate();

    // A call that fails before minting must not consume a sequence number.
    const foreign = service.dispatch(other.attachment.editorId, transaction());
    expect(foreign.ok).toBe(false);

    const callerOwned = service.dispatch(
      attachment.editorId,
      transaction({ operationId: "caller:7" as never }),
    );
    expect(callerOwned.ok).toBe(true);
    if (!callerOwned.ok) throw new Error("dispatch failed");
    expect(callerOwned.value.operationId).toBe("caller:7");

    const mintedFirst = service.dispatch(attachment.editorId, transaction());
    expect(mintedFirst.ok).toBe(true);
    if (!mintedFirst.ok) throw new Error("dispatch failed");
    expect(mintedFirst.value.operationId).toBe("editor-operation:1");

    const mintedSecond = service.dispatch(attachment.editorId, transaction());
    expect(mintedSecond.ok).toBe(true);
    if (!mintedSecond.ok) throw new Error("dispatch failed");
    expect(mintedSecond.value.operationId).toBe("editor-operation:2");

    expect(seenByFilter).toEqual(["caller:7", "editor-operation:1", "editor-operation:2"]);
    expect(listenerTransactions.map((item) => item.operationId)).toEqual([
      "caller:7",
      "editor-operation:1",
      "editor-operation:2",
    ]);

    // A commit the user typed has no caller, so the identity key is absent rather
    // than present-and-undefined.
    editor.replaceRange(0, 0, "U");
    const fromUserEdit = listenerTransactions.at(-1)!;
    expect(Object.hasOwn(fromUserEdit, "operationId")).toBe(false);
    expect(fromUserEdit.changes).toStrictEqual([{ from: 0, to: 0, insert: "U" }]);
  });

  it("passes annotations through by identity", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const annotations = { ns: { a: 1 } };
    const replacedAnnotations = { ns: { b: 2 } };
    const seenByFilter: Array<unknown> = [];
    const listenerTransactions: EditorTransaction[] = [];

    const filter = service.registerFilter((context) => {
      seenByFilter.push(context.transaction.annotations);
      return {
        action: "replace",
        transaction: { ...context.transaction, annotations: replacedAnnotations },
      };
    });
    expect(filter.ok).toBe(true);
    const listener = service.registerUpdateListener((update) => {
      listenerTransactions.push(update.transaction);
    });
    expect(listener.ok).toBe(true);
    await collector.activate();

    const result = service.dispatch(attachment.editorId, transaction({ annotations }));

    expect(result.ok).toBe(true);
    expect(seenByFilter).toHaveLength(1);
    expect(seenByFilter[0]).toBe(annotations);
    expect(listenerTransactions).toHaveLength(1);
    // The replacement's own annotations do not become the caller's identity.
    expect(listenerTransactions[0]!.annotations).toBe(annotations);
    expect(annotations).toStrictEqual({ ns: { a: 1 } });

    // A user-typed commit carries no caller metadata at all.
    editor.replaceRange(0, 0, "U");
    const fromUserEdit = listenerTransactions.at(-1)!;
    expect(Object.hasOwn(fromUserEdit, "annotations")).toBe(false);
  });

  it("runs filters by priority then registration order", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const order: string[] = [];

    const lower = service.registerFilter(
      () => {
        order.push("low");
        return { action: "accept" };
      },
      { priority: -10 },
    );
    expect(lower.ok).toBe(true);
    const higherFirst = service.registerFilter(
      () => {
        order.push("high-first");
        return { action: "accept" };
      },
      { priority: 10 },
    );
    expect(higherFirst.ok).toBe(true);
    const higherSecond = service.registerFilter(
      () => {
        order.push("high-second");
        return { action: "accept" };
      },
      { priority: 10 },
    );
    expect(higherSecond.ok).toBe(true);
    const listenerHigh = service.registerUpdateListener(() => order.push("listener-high"), {
      priority: 5,
    });
    expect(listenerHigh.ok).toBe(true);
    const listenerLow = service.registerUpdateListener(() => order.push("listener-low"));
    expect(listenerLow.ok).toBe(true);
    await collector.activate();

    const result = service.dispatch(attachment.editorId, transaction());

    expect(result.ok).toBe(true);
    expect(order).toEqual(["high-first", "high-second", "low", "listener-high", "listener-low"]);

    const outOfRange = service.registerFilter(() => ({ action: "accept" }), { priority: 1_001 });
    expect(outOfRange.ok).toBe(false);
    if (outOfRange.ok) throw new Error("out-of-range priority was accepted");
    expect(outOfRange.diagnostic.code).toBe("registration-conflict");
    expect(outOfRange.diagnostic.message).toContain("-1000");
    expect(outOfRange.diagnostic.message).toContain("1000");
    expect(diagnostics).toHaveLength(1);
    // Literal truth, not an echo of the value under test.
    expect(diagnostics[0]!.message).toBe(
      "Transaction hook priority must be an integer between -1000 and 1000",
    );
    expect(editor.getDocument()).toBe("Xalpha");
  });

  it("releases hooks when the owning plugin unloads", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const sink = editor.getContributionSink();
    const installPhysical = sink.registerTransactionFilter.bind(sink);
    const physicalRegistrations: EditorContributionRegistration[] = [];
    const spy = vi
      .spyOn(sink, "registerTransactionFilter")
      .mockImplementation((ownerId, filter, options) => {
        const registration = installPhysical(ownerId, filter, options);
        physicalRegistrations.push(registration);
        return registration;
      });

    const capabilities = new RuntimeCapabilityRegistry();
    capabilities.registerOwnerBound(
      EDITOR_TRANSACTIONS_CAPABILITY,
      ({ owner, registerResource }) => pipeline.createService(owner, registerResource),
      { context: { editorId: attachment.editorId } },
    );
    const validator = new PluginCompatibilityValidator({
      hostId: "test-host",
      hostVersion: "5.0.0",
      apiVersion: "1.5.0",
      platform: "headless",
      capabilities,
      capabilityContext: { editorId: attachment.editorId },
    });
    const loader = new TrustedPluginPackageLoader({
      validator,
      entrypoints: new HostControlledPluginEntrypointLoader({
        loadEntrypoint: async () => ({ default: FilterPlugin }),
      }),
    });
    const manager = new PluginManager({
      host: { id: "test-host", name: "Test Host", version: "5.0.0", platform: "headless" },
      apiVersion: "1.5.0",
      loader,
    });

    const seen: string[] = [];
    class FilterPlugin extends NexusPluginBase {
      override onload(): void {
        const transactions = this.app.capabilities.require(
          EDITOR_TRANSACTIONS_CAPABILITY,
          "^1.0.0",
          { editorId: attachment.editorId },
        );
        const registration = transactions.registerFilter((context) => {
          seen.push(context.transaction.changes.map((change) => change.insert).join(""));
          return { action: "accept" };
        });
        if (!registration.ok) throw new Error("filter registration failed");
      }
    }

    const discovery = manager.discover({
      authorManifest: {
        id: "transactions-unload-fixture",
        name: "Transactions Unload Fixture",
        version: "1.0.0",
        entrypoint: "main.js",
        apiVersion: "^1.0.0",
        requiredCapabilities: [
          { id: EDITOR_TRANSACTIONS_CAPABILITY.id, version: "^1.0.0", scope: "editor" },
        ],
      },
      host: { source: { kind: "development", locator: "fixture:transactions-unload" } },
    });
    expect(discovery.ok).toBe(true);

    const enabled = await manager.enable("transactions-unload-fixture");
    expect(enabled.ok).toBe(true);
    expect(physicalRegistrations).toHaveLength(1);

    editor.replaceRange(5, 5, "P");
    expect(seen).toEqual(["P"]);
    expect(editor.getDocument()).toBe("alphaP");

    const disabled = await manager.disable("transactions-unload-fixture");
    expect(disabled).toMatchObject({ state: "disabled", clean: true });
    expect(physicalRegistrations[0]!.disposed).toBe(true);

    editor.replaceRange(0, 0, "Q");
    expect(seen).toEqual(["P"]);
    expect(editor.getDocument()).toBe("QalphaP");
    spy.mockRestore();
  });

  it("leaves no transaction hook behind across attach/detach cycles", async () => {
    const registry = new EditorHostRegistry({ editorIdPrefix: "cycle-editor" });
    const physicalRegistrations: EditorContributionRegistration[] = [];
    const callsPerRound: number[] = [];

    for (let round = 0; round < 3; round += 1) {
      const container = document.createElement("div");
      document.body.append(container);
      const editor = createEditor({ container, initialValue: "alpha" });
      liveEditors.push({ editor, container });
      const attachment = registry.attach({
        editor,
        surface: { kind: "document", id: `cycle-surface-${round}`, root: container },
      });
      const sink = editor.getContributionSink();
      const installFilter = sink.registerTransactionFilter.bind(sink);
      const installListener = sink.registerUpdateListener.bind(sink);
      const filterSpy = vi
        .spyOn(sink, "registerTransactionFilter")
        .mockImplementation((ownerId, filter, options) => {
          const registration = installFilter(ownerId, filter, options);
          physicalRegistrations.push(registration);
          return registration;
        });
      const listenerSpy = vi
        .spyOn(sink, "registerUpdateListener")
        .mockImplementation((ownerId, listener, options) => {
          const registration = installListener(ownerId, listener, options);
          physicalRegistrations.push(registration);
          return registration;
        });

      const pipeline = createPipeline(attachment);
      const collector = createResourceCollector();
      const service = pipeline.createService(owner(), collector.register);
      let calls = 0;
      service.registerFilter(() => {
        calls += 1;
        return { action: "accept" };
      });
      service.registerUpdateListener(() => undefined);
      await collector.activate();

      editor.replaceRange(5, 5, "X");
      expect(calls).toBe(1);

      // The host's detach cleanup (C4): release the service, then the attachment.
      await pipeline.dispose();
      await attachment.detach();

      editor.replaceRange(0, 0, "Y");
      expect(calls).toBe(1);
      callsPerRound.push(calls);
      filterSpy.mockRestore();
      listenerSpy.mockRestore();
    }

    expect(callsPerRound).toEqual([1, 1, 1]);
    expect(physicalRegistrations).toHaveLength(6);
    expect(physicalRegistrations.every((registration) => registration.disposed)).toBe(true);
  });

  it("hands the live editor context to hooks after a context update", async () => {
    const { container, editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const filterContexts: EditorTransactionContext[] = [];
    const listenerDocuments: string[] = [];

    const filter = service.registerFilter((context) => {
      filterContexts.push(context);
      return { action: "accept" };
    });
    expect(filter.ok).toBe(true);
    const listener = service.registerUpdateListener((update) => {
      listenerDocuments.push(update.documentAfter);
    });
    expect(listener.ok).toBe(true);
    await collector.activate();

    await attachment.updateContext({
      surface: { kind: "document", id: "next-surface", root: container },
    });

    editor.replaceRange(0, 0, "X");

    expect(filterContexts).toHaveLength(1);
    const context = filterContexts[0]!;
    // The hook sees the context the host is serving right now, not the one captured
    // when the pipeline was constructed.
    expect(context.surface).toBe(attachment.context.surface);
    expect(context.surface.id).toBe("next-surface");
    expect(context.editorId).toBe(attachment.context.editorId);
    expect(context.editor).toBe(attachment.context.editor);
    expect(context.file).toBe(attachment.context.file);
    expect(context.sourcePath).toBe(attachment.context.sourcePath);
    expect(context.view).toBe(attachment.context.view);
    expect(context.leaf).toBe(attachment.context.leaf);
    expect(context.window).toBe(attachment.context.window);
    expect(context.contributions).toBe(attachment.context.contributions);
    expect(listenerDocuments).toEqual(["Xalpha"]);
  });

  it("fails explicitly for another editor's id", async () => {
    const first = attachRealEditor("alpha");
    const second = attachRealEditor("beta", "other-editor");
    const collectorA = createResourceCollector();
    const serviceA = createPipeline(first.attachment).createService(owner(), collectorA.register);
    const collectorB = createResourceCollector();
    const serviceB = createPipeline(second.attachment).createService(
      owner("other-fixture"),
      collectorB.register,
    );
    let notificationsOnSecond = 0;
    serviceB.registerUpdateListener(() => {
      notificationsOnSecond += 1;
    });
    await collectorA.activate();
    await collectorB.activate();

    const foreign = serviceA.dispatch(second.attachment.editorId, transaction());

    expect(foreign.ok).toBe(false);
    if (foreign.ok) throw new Error("cross-editor dispatch succeeded");
    expect(foreign.diagnostic.code).toBe("unsupported-operation");
    expect(foreign.diagnostic.message).toContain(second.attachment.editorId);
    // No forwarding: neither document moved and the other editor's hooks stayed idle.
    expect(first.editor.getDocument()).toBe("alpha");
    expect(second.editor.getDocument()).toBe("beta");
    expect(notificationsOnSecond).toBe(0);

    const own = serviceA.dispatch(first.attachment.editorId, transaction());
    expect(own.ok).toBe(true);
    expect(first.editor.getDocument()).toBe("Xalpha");
    expect(second.editor.getDocument()).toBe("beta");
  });

  it("fails explicitly after disposal and after editor destruction", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    await collector.activate();

    await pipeline.dispose();
    await pipeline.dispose();
    expect(collector.resources).toHaveLength(0);

    const lateFilter = service.registerFilter(() => ({ action: "accept" }));
    expect(lateFilter.ok).toBe(false);
    if (lateFilter.ok) throw new Error("registration after dispose was accepted");
    expect(lateFilter.diagnostic.code).toBe("unsupported-operation");
    expect(lateFilter.diagnostic.message).toBe("The editor transaction service has been disposed");
    expect(collector.resources).toHaveLength(0);

    const lateListener = service.registerUpdateListener(() => undefined);
    expect(lateListener.ok).toBe(false);
    expect(collector.resources).toHaveLength(0);

    const afterDispose = service.dispatch(attachment.editorId, transaction());
    expect(afterDispose.ok).toBe(false);
    if (afterDispose.ok) throw new Error("dispatch after dispose was accepted");
    expect(afterDispose.diagnostic.code).toBe("unsupported-operation");
    expect(afterDispose.diagnostic.message).toBe("The editor transaction service has been disposed");
    expect(editor.getDocument()).toBe("alpha");
    // Each rejection is reported rather than silently swallowed.
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "The editor transaction service has been disposed",
      "The editor transaction service has been disposed",
      "The editor transaction service has been disposed",
    ]);

    const destroyed = attachRealEditor("gamma", "destroyed-editor");
    const destroyedCollector = createResourceCollector();
    const destroyedService = createPipeline(destroyed.attachment).createService(
      owner(),
      destroyedCollector.register,
    );
    destroyed.editor.destroy();

    const afterDestroy = destroyedService.dispatch(
      destroyed.attachment.editorId,
      transaction(),
    );
    expect(afterDestroy.ok).toBe(false);
    if (afterDestroy.ok) throw new Error("dispatch after destroy was accepted");
    expect(afterDestroy.diagnostic.code).toBe("unsupported-operation");
    expect(afterDestroy.diagnostic.message).toBe("editor-destroyed");
    expect(afterDestroy.diagnostic.resourceId).toBe("host");
  });
});


describe("boundary locks: plugin faults degrade instead of vetoing or escaping", () => {
  it("bypasses a replace result whose structure is missing instead of letting core veto the commit", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const malformedReplacements: Array<[string, unknown]> = [
      ["missing transaction", { action: "replace" }],
      ["undefined transaction", { action: "replace", transaction: undefined }],
      ["non-iterable changes", { action: "replace", transaction: { ...transaction(), changes: null } }],
      ["null change entry", { action: "replace", transaction: { ...transaction(), changes: [null] } }],
    ];
    let selected: unknown = malformedReplacements[0]![1];
    const malformed = service.registerFilter(() => selected as never);
    expect(malformed.ok).toBe(true);
    await collector.activate();

    for (const [label, payload] of malformedReplacements) {
      selected = payload;
      const before = editor.getDocument();
      let result!: ReturnType<typeof service.dispatch>;
      expect(() => {
        result = service.dispatch(attachment.editorId, transaction());
      }, label).not.toThrow();
      expect(result.ok, label).toBe(true);
      expect(editor.getDocument(), label).toBe("X" + before);
      expect(diagnostics.at(-1), label).toMatchObject({ code: "callback-failed", phase: "callback" });
    }
    // Core's own filter-error veto path stays unreachable for plugin faults.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("takes over a rejected promise returned by a filter so it cannot surface later", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const registered = service.registerFilter(() => Promise.reject(new Error("filter boom")) as never);
    expect(registered.ok).toBe(true);
    await collector.activate();

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const result = service.dispatch(attachment.editorId, transaction());
      expect(result.ok).toBe(true);
      expect(editor.getDocument()).toBe("Xalpha");
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    // Two diagnostics, one fault: the pipeline reports the synchronous contract violation when
    // it sees the promise, and the adopted rejection carries the filter's own failure reason.
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toContain(
      "Editor transaction filters must return synchronously",
    );
    expect(diagnostics.at(-1)).toMatchObject({
      code: "callback-failed",
      phase: "callback",
      cause: { name: "Error", message: "filter boom" },
    });
    expect(rejections).toEqual([]);
  });

  it("reports an async update listener that rejects without leaving an unhandled rejection", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const registered = service.registerUpdateListener((async () => {
      throw new Error("listener boom");
    }) as never);
    expect(registered.ok).toBe(true);
    await collector.activate();

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      const result = service.dispatch(attachment.editorId, transaction());
      expect(result.ok).toBe(true);
      expect(editor.getDocument()).toBe("Xalpha");
      await new Promise((resolve) => setTimeout(resolve, 50));
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    expect(diagnostics.at(-1)).toMatchObject({
      code: "callback-failed",
      phase: "callback",
      cause: { name: "Error", message: "listener boom" },
    });
    expect(rejections).toEqual([]);
  });

  it("refuses a dispatch with a missing transaction instead of throwing at the caller", async () => {
    const { attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment);
    const service = pipeline.createService(owner(), () => undefined);
    const payloads: Array<[string, unknown]> = [
      ["undefined", undefined],
      ["null", null],
      ["number", 0],
    ];
    for (const [label, payload] of payloads) {
      let result!: ReturnType<typeof service.dispatch>;
      expect(() => {
        result = service.dispatch(attachment.editorId, payload as never);
      }, label).not.toThrow();
      expect(result.ok, label).toBe(false);
      if (result.ok) throw new Error(label + ": dispatch was accepted");
      expect(result.diagnostic.code, label).toBeDefined();
    }
  });

  it("survives a diagnostic reporter that throws", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const pipeline = createPipeline(attachment, () => {
      throw new Error("reporter boom");
    });
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const registered = service.registerFilter((context) => {
      if (context.transaction.userEvent === "boom") throw new Error("filter exploded");
      return { action: "accept" };
    });
    expect(registered.ok).toBe(true);
    await collector.activate();

    let result!: ReturnType<typeof service.dispatch>;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => {
      result = service.dispatch(attachment.editorId, transaction({ userEvent: "boom" }));
    }).not.toThrow();
    expect(result.ok).toBe(true);
    expect(editor.getDocument()).toBe("Xalpha");
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("keeps a failing resource registrar from reporting a successful registration", async () => {
    const { attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    const pipeline = createPipeline(attachment, (diagnostic) => diagnostics.push(diagnostic));
    const service = pipeline.createService(owner(), () => {
      throw new Error("register boom");
    });

    let result!: ReturnType<typeof service.registerFilter>;
    expect(() => {
      result = service.registerFilter(() => ({ action: "accept" }));
    }).not.toThrow();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("a failing registrar reported a successful registration");
    expect(result.diagnostic.code).toBeDefined();
    await pipeline.dispose();
  });

  it("bypasses a filter whose replacement cannot be validated because the context is gone", async () => {
    const { editor, attachment } = attachRealEditor("alpha");
    const diagnostics: NexusDiagnostic[] = [];
    let contextBroken = false;
    const pipeline = new EditorTransactionPipeline({
      context: () => {
        if (contextBroken) throw new Error("context boom");
        return attachment.context;
      },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const collector = createResourceCollector();
    const service = pipeline.createService(owner(), collector.register);
    const registered = service.registerFilter(() => {
      contextBroken = true;
      return { action: "replace", transaction: transaction() };
    });
    expect(registered.ok).toBe(true);
    await collector.activate();

    let result!: ReturnType<typeof service.dispatch>;
    expect(() => {
      result = service.dispatch(attachment.editorId, transaction());
    }).not.toThrow();
    expect(result.ok).toBe(true);
    expect(editor.getDocument()).toBe("Xalpha");
    expect(diagnostics.at(-1)).toMatchObject({ code: "callback-failed", phase: "callback" });
  });
});
