import type { Root } from "mdast";
import type { Plugin } from "unified";
import { describe, expect, it } from "vitest";

import {
  createEditor,
  markdownTransformSnapshotExtension,
  type MarkdownTransformPerformanceSample,
} from "../src/index";

describe("markdown transform performance observer", () => {
  it("reports each native contribution snapshot with its registryId and version", () => {
    const container = document.createElement("div");
    const samples: MarkdownTransformPerformanceSample[] = [];
    const editor = createEditor({
      container,
      initialValue: "# Hello",
      plugins: [
        {
          name: "perf-native",
          cmExtensions: [
            markdownTransformSnapshotExtension({
              registryId: "plugin.perf-native",
              version: 3,
              transform: (tree: Root): Root => tree,
            }),
          ],
        },
      ],
      markdownTransformObserver: (sample) => {
        samples.push(sample);
      },
    });

    // Initial headless parse happens before the view exists, so trigger a
    // document change to run the live snapshot path.
    editor.setDocument("# World");

    const native = samples.filter(
      (sample): sample is Extract<MarkdownTransformPerformanceSample, { kind: "contribution" }> =>
        sample.kind === "contribution" && sample.registryId === "plugin.perf-native",
    );
    expect(native.length).toBeGreaterThan(0);
    expect(native[0]?.version).toBe(3);
    expect(native[0]?.durationMs).toBeGreaterThanOrEqual(0);

    editor.destroy();
  });

  it("reports the legacy unified remark pipeline as one whole-pipeline sample", () => {
    const container = document.createElement("div");
    const samples: MarkdownTransformPerformanceSample[] = [];
    // A remark plugin that mutates the tree so the processor pipeline is
    // actually exercised (not a no-op fast path).
    const appendFooter: Plugin<[], Root, Root> = () => (tree) => {
      tree.children.push({
        type: "html",
        value: "<footer>perf</footer>",
      } as never);
    };
    const editor = createEditor({
      container,
      initialValue: "# Hello",
      plugins: [
        {
          name: "perf-legacy",
          remarkPlugins: [appendFooter],
        },
      ],
      markdownTransformObserver: (sample) => {
        samples.push(sample);
      },
    });

    editor.setDocument("# World");

    const legacy = samples.filter((sample) => sample.kind === "legacy-pipeline");
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy[0]?.durationMs).toBeGreaterThanOrEqual(0);
    // The legacy pipeline ran its transforms — the AST must reflect it.
    expect(
      editor.getAst().children.some((child) => child.type === "html"),
    ).toBe(true);

    editor.destroy();
  });

  it("leaves the AST pipeline unchanged when no observer is configured", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Hello",
      plugins: [
        {
          name: "perf-native",
          cmExtensions: [
            markdownTransformSnapshotExtension({
              registryId: "plugin.perf-native",
              version: 1,
              transform: (tree: Root): Root => tree,
            }),
          ],
        },
      ],
    });

    expect(editor.getDocument()).toBe("# Hello");
    expect(editor.getAst().children[0]?.type).toBe("heading");

    editor.destroy();
  });

  it("isolates a throwing observer so the transform pipeline keeps working", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Hello",
      plugins: [
        {
          name: "perf-native",
          cmExtensions: [
            markdownTransformSnapshotExtension({
              registryId: "plugin.perf-native",
              version: 1,
              transform: (tree: Root): Root => tree,
            }),
          ],
        },
      ],
      // A hostile host observer must not be able to take down the editor.
      markdownTransformObserver: () => {
        throw new Error("host observer failed");
      },
    });

    // Document changes and AST resync must survive the throwing observer.
    expect(() => editor.setDocument("# World")).not.toThrow();
    expect(editor.getDocument()).toBe("# World");
    expect(editor.getAst().children[0]?.type).toBe("heading");
    expect(editor.getTableOfContents()).toHaveLength(1);

    // Subsequent edits keep flowing through the same guarded path.
    expect(() => editor.setDocument("plain text")).not.toThrow();
    expect(editor.getAst().children[0]?.type).toBe("paragraph");

    editor.destroy();
  });
});
