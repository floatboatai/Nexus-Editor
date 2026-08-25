import { describe, expect, it } from "vitest";

import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

import { createEditor } from "../src/index";
import { htmlTableToGfm } from "../src/smart-paste/html-table-to-gfm";
import { applyUrlLinkify } from "../src/smart-paste/url-linkify";
import type { EditorAPI } from "../src/types";

/**
 * jsdom's `ClipboardEvent` ignores `clipboardData` in the init dict, so tests
 * stamp a plain object onto a generic cancelable Event — the same pattern the
 * asset-upload paste tests use.
 */
function makeClipboardEvent(
  type: "paste" | "copy" | "cut",
  flavors: Record<string, string> = {},
  extra: Record<string, unknown> = {},
): Event & { clipboardData: { getData(t: string): string; setData(t: string, v: string): void } } {
  const store = new Map(Object.entries(flavors));
  const data = {
    getData: (t: string) => store.get(t) ?? "",
    setData: (t: string, v: string) => {
      store.set(t, v);
    },
    files: [],
    items: [],
    ...extra,
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { configurable: true, value: data });
  return event as never;
}

function createSmartPasteEditor(
  initialValue: string,
  config: Record<string, unknown> = {},
): { editor: EditorAPI; content: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({ container, initialValue, smartPaste: true, ...config });
  const content = container.querySelector<HTMLElement>(".cm-content");
  if (!content) throw new Error("editor content DOM not found");
  return { editor, content };
}

describe("htmlTableToGfm", () => {
  it("converts a basic two-column table with a generated delimiter row", () => {
    const html = "<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>";
    expect(htmlTableToGfm(html)).toBe(
      ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n"),
    );
  });

  it("reads rows out of thead/tbody structures", () => {
    const html = "<table><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody><tr><td>a</td></tr></tbody></table>";
    expect(htmlTableToGfm(html)).toBe(
      ["| h1 | h2 |", "| --- | --- |", "| a |  |"].join("\n"),
    );
  });

  it("maps text-align styles and align attributes to delimiter markers", () => {
    const html =
      '<table><tr>' +
      '<th style="text-align: right">r</th>' +
      '<th align="center">c</th>' +
      '<th style="text-align:left">l</th>' +
      "</tr></table>";
    expect(htmlTableToGfm(html)).toBe(
      ["| r | c | l |", "| ---: | :---: | :--- |"].join("\n"),
    );
  });

  it("escapes literal pipes so the column structure survives a re-parse", () => {
    const html = "<table><tr><td>a|b</td></tr></table>";
    expect(htmlTableToGfm(html)).toBe(["| a\\|b |", "| --- |"].join("\n"));
  });

  it("flattens <br> to a space", () => {
    const html = "<table><tr><td>line1<br>line2</td></tr></table>";
    expect(htmlTableToGfm(html)).toBe(["| line1 line2 |", "| --- |"].join("\n"));
  });

  it("serializes inline formatting, including nesting", () => {
    const html =
      "<table><tr>" +
      "<td><b>bold</b></td>" +
      "<td><i>it</i></td>" +
      "<td><code>x = 1</code></td>" +
      '<td><a href="https://example.com">link</a></td>' +
      "<td><strong><em>both</em></strong></td>" +
      "</tr></table>";
    expect(htmlTableToGfm(html)).toBe(
      [
        "| **bold** | *it* | `x = 1` | [link](https://example.com) | ***both*** |",
        "| --- | --- | --- | --- | --- |",
      ].join("\n"),
    );
  });

  it("collapses whitespace at formatting boundaries so emphasis stays valid", () => {
    const html = "<table><tr><td> <b> a </b> </td></tr></table>";
    expect(htmlTableToGfm(html)).toBe(["| **a** |", "| --- |"].join("\n"));
  });

  it("pads ragged rows and drops overflow cells", () => {
    const html = "<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>1</td></tr></table>";
    expect(htmlTableToGfm(html)).toBe(
      ["| a | b | c |", "| --- | --- | --- |", "| 1 |  |  |"].join("\n"),
    );
  });

  it("keeps empty cells without collapsing the column count", () => {
    const html = "<table><tr><td></td><td>x</td></tr></table>";
    expect(htmlTableToGfm(html)).toBe(["|  | x |", "| --- | --- |"].join("\n"));
  });

  it("unwraps Office-style wrapper markup around the table", () => {
    const html = '<html><body><!--StartFragment--><table><tr><td>v</td></tr></table><!--EndFragment--></body></html>';
    expect(htmlTableToGfm(html)).toBe(["| v |", "| --- |"].join("\n"));
  });

  it("returns null for non-table HTML, empty input, or a cell-less table", () => {
    expect(htmlTableToGfm("<p>hello</p>")).toBeNull();
    expect(htmlTableToGfm("")).toBeNull();
    expect(htmlTableToGfm("<table><tr></tr></table>")).toBeNull();
  });
});

describe("applyUrlLinkify", () => {
  it("wraps a plain single-line selection", () => {
    expect(applyUrlLinkify("https://example.com", "nexus")).toBe(
      "[nexus](https://example.com)",
    );
  });

  it("uses the old URL as the label when the selection is itself a URL", () => {
    expect(applyUrlLinkify("https://new.example.com", "https://old.example.com")).toBe(
      "[https://old.example.com](https://new.example.com)",
    );
  });

  it("falls through for a collapsed selection (empty label)", () => {
    expect(applyUrlLinkify("https://example.com", "")).toBeNull();
  });

  it("falls through when the pasted text is not a single http(s) URL", () => {
    expect(applyUrlLinkify("example.com", "text")).toBeNull();
    expect(applyUrlLinkify("ftp://example.com", "text")).toBeNull();
    expect(applyUrlLinkify("https://example.com extra", "text")).toBeNull();
    expect(applyUrlLinkify("plain text", "text")).toBeNull();
  });

  it("falls through for multi-line selections", () => {
    expect(applyUrlLinkify("https://example.com", "line one\nline two")).toBeNull();
  });

  it("falls through when the selection already contains link syntax", () => {
    expect(applyUrlLinkify("https://example.com", "[label](https://x)")).toBeNull();
    expect(applyUrlLinkify("https://example.com", "[partial")).toBeNull();
  });

  it("escapes brackets in the label and angle-wraps awkward targets", () => {
    expect(applyUrlLinkify("https://example.com/a(b)", "weird [label]")).toBe(
      "[weird \\[label\\]](<https://example.com/a(b)>)",
    );
  });
});

describe("smart paste integration", () => {
  it("inserts a GFM table for an HTML table paste, atomically", () => {
    const { editor, content } = createSmartPasteEditor("before\n", {
      plugins: [createHistoryPlugin()],
    });
    // CM6 初始光标在文档开头；把光标放到插入点（文档末尾）再粘贴。
    editor.setSelection(editor.getDocument().length);
    const before = editor.getDocument();

    const event = makeClipboardEvent("paste", {
      "text/html": "<table><tr><td>a</td><td>b</td></tr><tr><td>1</td><td>2</td></tr></table>",
      "text/plain": "a\tb\n1\t2",
    });
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getDocument()).toBe("before\n| a | b |\n| --- | --- |\n| 1 | 2 |");

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe(before);
    editor.destroy();
  });

  it("linkifies a URL pasted over a selection", () => {
    const { editor, content } = createSmartPasteEditor("Try Nexus today");
    editor.setSelection(4, 9); // "Nexus"

    const event = makeClipboardEvent("paste", {
      "text/plain": "https://github.com/floatboatai/Nexus-Editor",
    });
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getDocument()).toBe(
      "Try [Nexus](https://github.com/floatboatai/Nexus-Editor) today",
    );
    editor.destroy();
  });

  it("reverts a linkify paste with a single undo", () => {
    const { editor, content } = createSmartPasteEditor("Try Nexus today", {
      plugins: [createHistoryPlugin()],
    });
    editor.setSelection(4, 9);

    content.dispatchEvent(makeClipboardEvent("paste", { "text/plain": "https://example.com" }));

    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("Try Nexus today");
    editor.destroy();
  });

  it("leaves URL paste untouched when the selection is collapsed", () => {
    const { editor, content } = createSmartPasteEditor("x");
    editor.setSelection(1);

    const event = makeClipboardEvent("paste", { "text/plain": "https://example.com" });
    content.dispatchEvent(event);

    expect(editor.getDocument()).toBe("xhttps://example.com");
    editor.destroy();
  });

  it("does not intercept HTML without a table", () => {
    const { editor, content } = createSmartPasteEditor("");

    const event = makeClipboardEvent("paste", {
      "text/html": "<p>hello</p>",
      "text/plain": "hello",
    });
    content.dispatchEvent(event);

    // 未被智能粘贴消费：CodeMirror 走默认纯文本插入。
    expect(editor.getDocument()).toBe("hello");
    editor.destroy();
  });

  it("respects per-behavior toggles", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({
      container,
      initialValue: "Try Nexus today",
      smartPaste: { linkify: false },
    });
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("editor content DOM not found");
    editor.setSelection(4, 9);

    content.dispatchEvent(makeClipboardEvent("paste", { "text/plain": "https://example.com" }));

    expect(editor.getDocument()).toBe("Try https://example.com today");
    editor.destroy();
  });

  it("keeps the default behavior when smartPaste is disabled", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const editor = createEditor({ container, initialValue: "" });
    const content = container.querySelector<HTMLElement>(".cm-content");
    if (!content) throw new Error("editor content DOM not found");

    const event = makeClipboardEvent("paste", {
      "text/html": "<table><tr><td>a</td></tr></table>",
      "text/plain": "a",
    });
    content.dispatchEvent(event);

    expect(editor.getDocument()).toBe("a");
    editor.destroy();
  });

  it("gives the asset-upload pipeline precedence over table conversion", async () => {
    const uploads: string[] = [];
    const { editor, content } = createSmartPasteEditor("", {
      onAssetUpload: async (file: File) => {
        uploads.push(file.name);
        return `assets/${file.name}`;
      },
    });

    const file = new File(["x"], "shot.png", { type: "image/png" });
    const event = makeClipboardEvent("paste", { "text/plain": "screenshot" }, { files: [file] });
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(uploads).toEqual(["shot.png"]);
    expect(editor.getDocument()).toBe("![shot.png](assets/shot.png)");
    editor.destroy();
  });

  it("attaches a text/markdown flavor on copy without consuming the event", () => {
    const { editor, content } = createSmartPasteEditor("# Title\n\nbody text");
    editor.setSelection(0, 7); // "# Title"

    const event = makeClipboardEvent("copy");
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(event.clipboardData.getData("text/markdown")).toBe("# Title");
    editor.destroy();
  });

  it("attaches the same flavor on cut", () => {
    const { editor, content } = createSmartPasteEditor("keep cut-me");
    editor.setSelection(5, 11); // "cut-me"

    const event = makeClipboardEvent("cut");
    content.dispatchEvent(event);

    expect(event.clipboardData.getData("text/markdown")).toBe("cut-me");
    editor.destroy();
  });

  it("skips the markdown flavor when the selection is collapsed", () => {
    const { editor, content } = createSmartPasteEditor("# Title");
    editor.setSelection(2);

    const event = makeClipboardEvent("copy");
    content.dispatchEvent(event);

    expect(event.clipboardData.getData("text/markdown")).toBe("");
    editor.destroy();
  });
});
