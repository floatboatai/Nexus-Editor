import { createEditor } from "@floatboat/nexus-core";
import { describe, expect, it, vi } from "vitest";

import { asDocumentId, createCollaborationEngine } from "../src";
import { createAssessmentProviderHub } from "../src/assessment";

const documentRef = {
  id: asDocumentId("9b8f4e80-97dd-47ed-993e-805178d7b08b"),
  hostIdentity: "markdown-port-tests",
};

describe("Collaborative Markdown File Projection port", () => {
  it("compares revisions, normalizes Markdown, and projects one intentional replacement everywhere", async () => {
    const hub = createAssessmentProviderHub();
    const firstEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const secondEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const first = await firstEngine.create(documentRef, { initialMarkdown: "base\n" });
    const second = await secondEngine.open(documentRef);
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({ container, initialValue: "base\n" });
    const binding = await second.attach(editor, { content: "require-match" });
    const observed = vi.fn();
    const unsubscribe = first.subscribeMarkdown(observed);
    const before = first.getMarkdownSnapshot();
    expect(before).toMatchObject({ markdown: "base\n" });

    const after = await first.replaceMarkdown("disk\r\nchange\r\n", {
      origin: "external-file",
      expectedRevision: before!.revision,
    });

    expect(after.markdown).toBe("disk\nchange\n");
    expect(after.revision).not.toBe(before!.revision);
    expect(second.getMarkdown()).toBe("disk\nchange\n");
    expect(editor.getDocument()).toBe("disk\nchange\n");
    expect(observed).toHaveBeenLastCalledWith(after);
    await expect(first.replaceMarkdown("stale", {
      origin: "file-conflict-resolution",
      expectedRevision: before!.revision,
    })).rejects.toMatchObject({ code: "projection-revision-conflict" });

    unsubscribe();
    await binding.detach();
    editor.destroy();
    container.remove();
    await first.close();
    await second.close();
    await firstEngine.close();
    await secondEngine.close();
    await hub.close();
  });

  it("does not let File Projection replace a read-only collaborative document", async () => {
    const hub = createAssessmentProviderHub();
    const writerEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
    const writer = await writerEngine.create(documentRef, { initialMarkdown: "shared" });
    const readOnlyFactory = {
      async prepare(context: Parameters<typeof hub.factory.prepare>[0]) {
        const lease = await hub.factory.prepare(context);
        const state = () => ({
          ...lease.getState(),
          authentication: "authenticated" as const,
          access: "read-only" as const,
        });
        return {
          start: () => lease.start(),
          getState: state,
          subscribe(listener: Parameters<typeof lease.subscribe>[0]) {
            return lease.subscribe(() => listener(state()));
          },
          release: () => lease.release(),
        };
      },
    };
    const readerEngine = createCollaborationEngine({ providers: readOnlyFactory, store: { mode: "volatile" } });
    const reader = await readerEngine.open(documentRef);
    const snapshot = reader.getMarkdownSnapshot();

    await expect(reader.replaceMarkdown("forbidden", {
      origin: "external-file",
      expectedRevision: snapshot!.revision,
    })).rejects.toMatchObject({ code: "read-only" });
    expect(writer.getMarkdown()).toBe("shared");

    await reader.close();
    await writer.close();
    await readerEngine.close();
    await writerEngine.close();
    await hub.close();
  });
});
