import type { Root } from "mdast";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { Plugin } from "unified";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "../src/index";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

function requireEditorView(view: EditorView | null): EditorView {
  if (!view) throw new Error("Expected CodeMirror view to be captured");
  return view;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createEditor", () => {
  it("creates an editor with the initial document", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "# Hello" });

    expect(editor.getDocument()).toBe("# Hello");
    expect(editor.getAst().children[0]?.type).toBe("heading");
    editor.destroy();
  });

  it("mounts into the provided container and removes editor dom on destroy", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "# Hello" });

    expect(container.querySelector(".cm-editor")).not.toBeNull();

    editor.destroy();

    expect(container.querySelector(".cm-editor")).toBeNull();
  });

  it("can create a read-only editor without host-provided CodeMirror extensions", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "# Hello", readOnly: true });
    const content = container.querySelector<HTMLElement>(".cm-content");

    expect(content?.getAttribute("contenteditable")).toBe("false");

    editor.destroy();
  });

  it("emits change, focus, and blur hooks with canonical document values", () => {
    const container = document.createElement("div");
    const events: string[] = [];
    const docs: string[] = [];
    const editor = createEditor({
      container,
      initialValue: "start",
      onChange(doc) {
        docs.push(doc);
      },
      onFocus() {
        events.push("focus");
      },
      onBlur() {
        events.push("blur");
      }
    });

    editor.focus();
    editor.setDocument("next");
    editor.blur();

    expect(editor.getDocument()).toBe("next");
    expect(docs).toEqual(["next"]);
    expect(events).toEqual(["focus", "blur"]);
    editor.destroy();
  });

  it("emits a parsed AST for the current markdown document", () => {
    const container = document.createElement("div");
    const nodeTypes: string[] = [];
    const editor = createEditor({
      container,
      onChange(_doc, ast) {
        nodeTypes.push(ast.type);
        nodeTypes.push(ast.children[0]?.type ?? "missing");
      }
    });

    editor.setDocument("# Heading");

    expect(nodeTypes).toEqual(["root", "heading"]);
    expect(editor.getAst().children[0]?.type).toBe("heading");
    editor.destroy();
  });

  it("preserves selection when setDocument is called with preserveSelection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(6, 11);
    editor.setDocument("hello nexus", { preserveSelection: true });

    expect(editor.getDocument()).toBe("hello nexus");
    expect(editor.getSelection()).toEqual({ anchor: 6, head: 11 });
    editor.destroy();
  });

  it("clamps preserved selection to the new document length", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "0123456789" });

    editor.setSelection(8, 10);
    editor.setDocument("abc", { preserveSelection: true });

    expect(editor.getSelection()).toEqual({ anchor: 3, head: 3 });
    editor.destroy();
  });

  it("applies explicit selection after setDocument", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "old" });

    editor.setDocument("new document", {
      selection: { anchor: 4, head: 12 },
    });

    expect(editor.getSelection()).toEqual({ anchor: 4, head: 12 });
    editor.destroy();
  });

  it("clamps explicit setDocument selection positions", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "old" });

    editor.setDocument("abc", {
      selection: { anchor: -10, head: 99 },
    });

    expect(editor.getSelection()).toEqual({ anchor: 0, head: 3 });
    editor.destroy();
  });

  it("lets explicit selection override preserveSelection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "old document" });

    editor.setSelection(0, 3);
    editor.setDocument("new document", {
      preserveSelection: true,
      selection: { anchor: 4 },
    });

    expect(editor.getSelection()).toEqual({ anchor: 4, head: 4 });
    editor.destroy();
  });

  it("preserves selection for silent document loads without emitting change", () => {
    const container = document.createElement("div");
    const docs: string[] = [];
    const editor = createEditor({
      container,
      initialValue: "# Old",
      onChange(doc) {
        docs.push(doc);
      },
    });

    editor.setSelection(2);
    editor.setDocument("# New", { silent: true, preserveSelection: true });

    expect(editor.getDocument()).toBe("# New");
    expect(editor.getSelection()).toEqual({ anchor: 2, head: 2 });
    expect(docs).toEqual([]);
    expect(editor.getAst().children[0]?.type).toBe("heading");
    editor.destroy();
  });

  it("keeps the editor usable when the parser throws", () => {
    const container = document.createElement("div");
    const docs: string[] = [];
    const editor = createEditor({
      container,
      parser: {
        parse() {
          throw new Error("boom");
        }
      },
      onChange(doc) {
        docs.push(doc);
      }
    });

    editor.setDocument("after failure");

    expect(editor.getDocument()).toBe("after failure");
    expect(docs).toEqual(["after failure"]);
    editor.destroy();
  });

  it("composes remark and shortcut plugin contributions", () => {
    const container = document.createElement("div");
    let nodeTypes: string[] = [];
    let shortcutResult = false;
    const appendParagraph: Plugin<[], Root, Root> = function () {
      return (tree) => {
        tree.children.push({
          type: "paragraph",
          children: [{ type: "text", value: "plugin" }]
        });
      };
    };
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "remark-transform",
          remarkPlugins: [appendParagraph]
        },
        {
          name: "shortcut",
          shortcuts: [
            {
              key: "Mod-k",
              run(api) {
                api.setDocument("shortcut-ran");
                shortcutResult = true;
                return true;
              }
            }
          ]
        }
      ],
      onChange(_doc, ast) {
        nodeTypes = ast.children.map((child: { type: string }) => child.type);
      }
    });

    editor.setDocument("# Heading");

    expect(nodeTypes).toEqual(["heading", "paragraph"]);
    expect(editor.runShortcut("Mod-k")).toBe(true);
    expect(shortcutResult).toBe(true);
    expect(editor.getDocument()).toBe("shortcut-ran");
    editor.destroy();
  });

  it("debounces parsing and emits only the latest document version", () => {
    vi.useFakeTimers();

    const container = document.createElement("div");
    const docs: string[] = [];
    const parser = {
      parse(markdown: string): Root {
        return {
          type: "root",
          children: [{ type: "paragraph", children: [{ type: "text", value: markdown }] }]
        };
      }
    };
    const editor = createEditor({
      container,
      parser,
      parseDelayMs: 20,
      onChange(doc) {
        docs.push(doc);
      }
    });

    editor.setDocument("first");
    editor.setDocument("second");

    expect(docs).toEqual([]);

    vi.advanceTimersByTime(20);

    expect(docs).toEqual(["second"]);
    editor.destroy();
  });

  it("defers change emission until IME composition ends", async () => {
    const container = document.createElement("div");
    const docs: string[] = [];
    let capturedView: EditorView | null = null;
    const captureView = ViewPlugin.fromClass(
      class {
        constructor(readonly view: EditorView) {
          capturedView = view;
        }
      }
    );
    const editor = createEditor({
      container,
      plugins: [{ name: "capture-view", cmExtensions: [captureView] }],
      onChange(doc) {
        docs.push(doc);
      }
    });

    expect(capturedView).not.toBeNull();
    const view = requireEditorView(capturedView);
    view.dispatch({
      changes: { from: 0, insert: "wjj" },
      userEvent: "input.type.compose",
    });

    expect(editor.getDocument()).toBe("wjj");
    expect(docs).toEqual([]);

    vi.useFakeTimers();
    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80);

    expect(docs).toEqual(["wjj"]);
    editor.destroy();
  });

  it("cancels pending parse work when the editor is destroyed", () => {
    vi.useFakeTimers();

    const container = document.createElement("div");
    const docs: string[] = [];
    const editor = createEditor({
      container,
      parseDelayMs: 20,
      onChange(doc) {
        docs.push(doc);
      }
    });

    editor.setDocument("queued");
    editor.destroy();

    vi.runAllTimers();

    expect(docs).toEqual([]);
  });

  it("emits focus lifecycle hooks from editor dom events", () => {
    const container = document.createElement("div");
    const events: string[] = [];
    const editor = createEditor({
      container,
      onFocus() {
        events.push("focus");
      },
      onBlur() {
        events.push("blur");
      }
    });

    const content = container.querySelector("[contenteditable='true']");

    expect(content).not.toBeNull();

    content?.dispatchEvent(new FocusEvent("focus"));
    content?.dispatchEvent(new FocusEvent("blur"));

    expect(events).toEqual(["focus", "blur"]);
    editor.destroy();
  });

  it("runs plugin shortcuts from codemirror key handling", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "keyboard-shortcut",
          shortcuts: [
            {
              key: "Ctrl-k",
              run(api) {
                api.setDocument("shortcut-keyboard");
                return true;
              }
            }
          ]
        }
      ]
    });

    const content = container.querySelector("[contenteditable='true']");

    expect(content).not.toBeNull();

    content?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    );

    expect(editor.getDocument()).toBe("shortcut-keyboard");
    editor.destroy();
  });

  it("aggregates slash commands from registered plugins", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "slash-a",
          slashCommands: [{ id: "heading", title: "Heading" }]
        },
        {
          name: "slash-b",
          slashCommands: [{ id: "table", title: "Table" }]
        }
      ]
    });

    expect(editor.getSlashCommands().map((command) => command.id)).toEqual(["heading", "table"]);
    editor.destroy();
  });

  it("delegates asset uploads through the configured host hook", async () => {
    const container = document.createElement("div");
    const file = new File(["image"], "image.png", { type: "image/png" });
    const editor = createEditor({
      container,
      onAssetUpload(uploadedFile) {
        expect(uploadedFile).toBe(file);
        return Promise.resolve("https://cdn.example.com/image.png");
      }
    });

    await expect(editor.uploadAsset(file)).resolves.toBe("https://cdn.example.com/image.png");
    editor.destroy();
  });

  it("stops emitting updates after destroy", () => {
    const container = document.createElement("div");
    const docs: string[] = [];
    const events: string[] = [];
    const editor = createEditor({
      container,
      onChange(doc) {
        docs.push(doc);
      },
      onFocus() {
        events.push("focus");
      },
      onBlur() {
        events.push("blur");
      }
    });

    editor.destroy();

    expect(() => editor.setDocument("after-destroy", { preserveSelection: true })).not.toThrow();
    expect(() => editor.focus()).not.toThrow();
    expect(() => editor.blur()).not.toThrow();

    expect(docs).toEqual([]);
    expect(events).toEqual([]);
  });

  it("composes cm extension contributions with built-in editor behavior", () => {
    const container = document.createElement("div");
    const seenDocs: string[] = [];
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "editor-attributes",
          cmExtensions: [EditorView.editorAttributes.of({ "data-plugin": "yes" })]
        },
        {
          name: "update-listener",
          cmExtensions: [
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                seenDocs.push(update.state.doc.toString());
              }
            })
          ]
        }
      ]
    });

    editor.setDocument("from-extension");

    expect(container.querySelector(".cm-editor")?.getAttribute("data-plugin")).toBe("yes");
    expect(seenDocs).toEqual(["from-extension"]);
    expect(editor.getDocument()).toBe("from-extension");
    editor.destroy();
  });

  // ── TOC extraction ──

  it("extracts table of contents from headings", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Title\n\nIntro\n\n## Section A\n\n### Sub\n\n## Section B"
    });

    const toc = editor.getTableOfContents();
    expect(toc).toHaveLength(4);
    expect(toc[0]).toMatchObject({ level: 1, text: "Title" });
    expect(toc[1]).toMatchObject({ level: 2, text: "Section A" });
    expect(toc[2]).toMatchObject({ level: 3, text: "Sub" });
    expect(toc[3]).toMatchObject({ level: 2, text: "Section B" });
    // Positions are valid
    expect(toc[0].from).toBe(0);
    expect(toc[0].to).toBe(7);
    editor.destroy();
  });

  it("returns empty array for document without headings", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Just text." });

    expect(editor.getTableOfContents()).toEqual([]);
    editor.destroy();
  });

  // ── getSelectedText ──

  it("returns empty string when selection is collapsed", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(5);
    expect(editor.getSelectedText()).toBe("");
    editor.destroy();
  });

  it("returns the selected slice of the document", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(6, 11);
    expect(editor.getSelectedText()).toBe("world");
    editor.destroy();
  });

  it("normalizes reversed selection (head < anchor)", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(11, 6); // anchor=11, head=6
    expect(editor.getSelectedText()).toBe("world");
    editor.destroy();
  });

  it("preserves newlines in multi-line selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "line one\nline two\nline three" });

    editor.setSelection(0, 17); // "line one\nline two"
    expect(editor.getSelectedText()).toBe("line one\nline two");
    editor.destroy();
  });

  // ── replaceRange ──

  it("replaceRange: replaces document content in the given range", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.replaceRange(6, 11, "earth");
    expect(editor.getDocument()).toBe("hello earth");
    editor.destroy();
  });

  it("replaceRange: repositions selection in the same dispatch", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.replaceRange(0, 5, "hi", { anchor: 0, head: 2 });
    expect(editor.getDocument()).toBe("hi world");
    expect(editor.getSelection()).toMatchObject({ anchor: 0, head: 2 });
    editor.destroy();
  });

  it("replaceRange: collapsed range (from === to) inserts without deleting", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.replaceRange(5, 5, ",");
    expect(editor.getDocument()).toBe("hello, world");
    editor.destroy();
  });

  it("replaceRange: silent suppresses onChange but getAst() stays consistent", () => {
    const container = document.createElement("div");
    const onChange = vi.fn();
    const editor = createEditor({ container, initialValue: "hello world", onChange });

    onChange.mockClear();
    editor.replaceRange(0, 11, "# Title", undefined, { silent: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getAst().type).toBe("root");
    editor.destroy();
  });

  it("replaceRange: produces exactly one undo entry", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world", plugins: [createHistoryPlugin()] });

    editor.replaceRange(6, 11, "earth");
    expect(editor.getDocument()).toBe("hello earth");
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("hello world");
    expect(editor.undo()).toBe(false);
    editor.destroy();
  });

  // ── HTML export ──

  it("exports markdown to semantic HTML", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      initialValue: "# Hello\n\n**bold** text\n\n```js\nconsole.log(1)\n```"
    });

    const html = editor.exportHTML();
    expect(html).toContain("<h1>Hello</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code");
    expect(html).toContain("console.log(1)");
    editor.destroy();
  });
});

function captureViewPlugin(onView: (view: EditorView) => void) {
  return ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        onView(view);
      }
    }
  );
}

function makePasteEvent(clipboardData: Record<string, unknown>): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  // 兜底 getData，避免放行后 CodeMirror 内置 paste 处理器在桩上抛错。
  const data = { getData: () => "", ...clipboardData };
  Object.defineProperty(event, "clipboardData", { configurable: true, value: data });
  return event;
}

function makeDropEvent(dataTransfer: Record<string, unknown>, clientX = 0, clientY = 0): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { configurable: true, value: dataTransfer },
    clientX: { configurable: true, value: clientX },
    clientY: { configurable: true, value: clientY },
  });
  return event;
}

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("createEditor — composition-safe setDocument", () => {
  it("reports composition state via isComposing()", () => {
    const container = document.createElement("div");
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "base",
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);

    expect(editor.isComposing()).toBe(false);
    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    expect(editor.isComposing()).toBe(true);
    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(editor.isComposing()).toBe(false);
    editor.destroy();
  });

  it("defers setDocument while IME composition is active, then applies it on compositionend", () => {
    const container = document.createElement("div");
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "base",
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);

    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    // 组合输入中宿主回灌文档：必须被推迟，不能整文档替换打断 IME。
    editor.setDocument("external load", { silent: true });
    expect(editor.getDocument()).toBe("base");

    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    // 组合输入结束后才应用被推迟的回灌。
    expect(editor.getDocument()).toBe("external load");
    editor.destroy();
  });

  it("keeps deferred setDocument selection options after IME composition ends", () => {
    const container = document.createElement("div");
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "hello world",
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);

    editor.setSelection(6, 11);
    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    editor.setDocument("hello nexus", { silent: true, preserveSelection: true });

    expect(editor.getDocument()).toBe("hello world");

    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));

    expect(editor.getDocument()).toBe("hello nexus");
    expect(editor.getSelection()).toEqual({ anchor: 6, head: 11 });
    editor.destroy();
  });

  it("uses the latest deferred setDocument call while IME composition is active", () => {
    const container = document.createElement("div");
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "base text",
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);

    editor.setSelection(5, 9);
    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    editor.setDocument("first", { preserveSelection: true });
    editor.setDocument("second", { selection: { anchor: 2, head: 99 } });

    expect(editor.getDocument()).toBe("base text");

    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));

    expect(editor.getDocument()).toBe("second");
    expect(editor.getSelection()).toEqual({ anchor: 2, head: 6 });
    editor.destroy();
  });

  it("keeps the in-flight composition text when no external load is pending", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    const docs: string[] = [];
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      onChange(doc) {
        docs.push(doc);
      },
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);

    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    view.dispatch({ changes: { from: 0, insert: "你好" }, userEvent: "input.type.compose" });
    expect(editor.getDocument()).toBe("你好");
    expect(docs).toEqual([]);

    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(80);

    expect(editor.getDocument()).toBe("你好");
    expect(docs).toEqual(["你好"]);
    editor.destroy();
  });
});

describe("createEditor — command registry", () => {
  it("aggregates named commands and runs them by id", () => {
    const container = document.createElement("div");
    const ran: string[] = [];
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "cmd",
          commands: [
            { id: "say-hi", label: "Say Hi", run: () => void ran.push("hi") },
            { id: "stop", run: () => false },
          ],
        },
      ],
    });

    expect(editor.getCommands().map((command) => command.id)).toEqual(["say-hi", "stop"]);
    expect(editor.runCommand("say-hi")).toBe(true);
    expect(ran).toEqual(["hi"]);
    // run 返回 false 视为未消费。
    expect(editor.runCommand("stop")).toBe(false);
    expect(editor.runCommand("missing")).toBe(false);
    editor.destroy();
  });

  it("binds command hotkeys into the keymap", () => {
    const container = document.createElement("div");
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "cmd",
          commands: [{ id: "insert-x", hotkey: "Ctrl-j", run: (api) => void api.setDocument("X") }],
        },
      ],
    });

    const content = container.querySelector("[contenteditable='true']");
    content?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "j", ctrlKey: true, bubbles: true, cancelable: true })
    );

    expect(editor.getDocument()).toBe("X");
    editor.destroy();
  });
});

describe("createEditor — DOM event hook layer", () => {
  it("lets plugin paste handlers consume the event before the default asset pipeline", () => {
    const container = document.createElement("div");
    const uploads: File[] = [];
    const editor = createEditor({
      container,
      onAssetUpload: (file) => {
        uploads.push(file);
        return Promise.resolve("uploaded");
      },
      plugins: [
        {
          name: "paste-hook",
          handlers: {
            paste: (_event, ctx) => {
              ctx.insertMarkdown("HOOK");
              return true;
            },
          },
        },
      ],
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    const file = new File(["img"], "x.png", { type: "image/png" });
    const event = makePasteEvent({ files: [file], items: [] });
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.getDocument()).toContain("HOOK");
    // 钩子已消费，默认上传管线不应执行。
    expect(uploads).toEqual([]);
    editor.destroy();
  });

  it("uploads clipboard image items that arrive without a files list", async () => {
    const container = document.createElement("div");
    const uploads: File[] = [];
    const editor = createEditor({
      container,
      onAssetUpload: (file) => {
        uploads.push(file);
        return Promise.resolve("assets/shot.png");
      },
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    const file = new File(["img"], "shot.png", { type: "image/png" });
    const event = makePasteEvent({ files: [], items: [{ kind: "file", getAsFile: () => file }] });
    content.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    await flushMicrotasks();

    expect(uploads).toEqual([file]);
    expect(editor.getDocument()).toContain("![shot.png](assets/shot.png)");
    editor.destroy();
  });

  it("keeps a pending asset paste at its mapped anchor without stealing a moved cursor", async () => {
    const container = document.createElement("div");
    const upload = createDeferred<string | null>();
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "AB",
      onAssetUpload: () => upload.promise,
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    editor.setSelection(1);
    const file = new File(["img"], "x.png", { type: "image/png" });
    content.dispatchEvent(makePasteEvent({ files: [file], items: [] }));
    view.dispatch({ changes: { from: 0, insert: "X" }, selection: { anchor: 3 } });

    upload.resolve("assets/x.png");
    await flushMicrotasks();

    expect(editor.getDocument()).toBe("XA![x.png](assets/x.png)B");
    expect(editor.getSelection()).toEqual({ anchor: editor.getDocument().length, head: editor.getDocument().length });
    editor.destroy();
  });

  it("replaces an untouched selection when its pending asset upload completes", async () => {
    const container = document.createElement("div");
    const upload = createDeferred<string | null>();
    const editor = createEditor({
      container,
      initialValue: "abc",
      onAssetUpload: () => upload.promise,
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    editor.setSelection(1, 2);
    const file = new File(["img"], "x.png", { type: "image/png" });
    content.dispatchEvent(makePasteEvent({ files: [file], items: [] }));
    upload.resolve("assets/x.png");
    await flushMicrotasks();

    expect(editor.getDocument()).toBe("a![x.png](assets/x.png)c");
    expect(editor.getSelection()).toEqual({ anchor: 23, head: 23 });
    editor.destroy();
  });

  it("does not overwrite a selection edited while its asset upload is pending", async () => {
    const container = document.createElement("div");
    const upload = createDeferred<string | null>();
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "abc",
      onAssetUpload: () => upload.promise,
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    editor.setSelection(1, 2);
    const file = new File(["img"], "x.png", { type: "image/png" });
    content.dispatchEvent(makePasteEvent({ files: [file], items: [] }));
    view.dispatch({ changes: { from: 1, to: 2, insert: "X" }, selection: { anchor: 2 } });

    upload.resolve("assets/x.png");
    await flushMicrotasks();

    expect(editor.getDocument()).toBe("a![x.png](assets/x.png)Xc");
    editor.destroy();
  });

  it.each([
    { boundary: "start", position: 1, expected: "aX![x.png](assets/x.png)c" },
    { boundary: "end", position: 2, expected: "a![x.png](assets/x.png)Xc" },
  ])(
    "keeps an edit at the selection $boundary boundary outside the pending asset replacement",
    async ({ position, expected }) => {
      const container = document.createElement("div");
      const upload = createDeferred<string | null>();
      let capturedView: EditorView | null = null;
      const editor = createEditor({
        container,
        initialValue: "abc",
        onAssetUpload: () => upload.promise,
        plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
      });
      const view = requireEditorView(capturedView);
      const content = container.querySelector("[contenteditable='true']") as HTMLElement;

      editor.setSelection(1, 2);
      const file = new File(["img"], "x.png", { type: "image/png" });
      content.dispatchEvent(makePasteEvent({ files: [file], items: [] }));
      view.dispatch({ changes: { from: position, insert: "X" }, selection: { anchor: position + 1 } });

      upload.resolve("assets/x.png");
      await flushMicrotasks();

      expect(editor.getDocument()).toBe(expected);
      editor.destroy();
    }
  );

  it("preserves every initiating selection when a pending asset paste completes", async () => {
    const container = document.createElement("div");
    const upload = createDeferred<string | null>();
    const editor = createEditor({
      container,
      initialValue: "AB",
      multiCursor: true,
      onAssetUpload: () => upload.promise,
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;
    const markdown = "![x.png](assets/x.png)";

    editor.setSelections([{ anchor: 0 }, { anchor: 2 }], 1);
    const file = new File(["img"], "x.png", { type: "image/png" });
    content.dispatchEvent(makePasteEvent({ files: [file], items: [] }));
    upload.resolve("assets/x.png");
    await flushMicrotasks();

    expect(editor.getDocument()).toBe(`${markdown}AB${markdown}`);
    expect(editor.getSelections()).toEqual({
      ranges: [
        { anchor: markdown.length, head: markdown.length },
        { anchor: markdown.length * 2 + 2, head: markdown.length * 2 + 2 },
      ],
      mainIndex: 1,
    });
    editor.destroy();
  });

  it("inserts a dropped asset at the pointer-derived document position", async () => {
    const container = document.createElement("div");
    const upload = createDeferred<string | null>();
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "AB",
      onAssetUpload: () => upload.promise,
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;
    const posAtCoords = vi.spyOn(view, "posAtCoords").mockReturnValue(1);

    editor.setSelection(2);
    const file = new File(["img"], "drop.png", { type: "image/png" });
    const event = makeDropEvent({ files: [file], items: [] }, 12, 34);
    content.dispatchEvent(event);
    upload.resolve("assets/drop.png");
    await flushMicrotasks();

    expect(event.defaultPrevented).toBe(true);
    expect(posAtCoords).toHaveBeenCalledWith({ x: 12, y: 34 });
    expect(editor.getDocument()).toBe("A![drop.png](assets/drop.png)B");

    posAtCoords.mockReturnValue(null);
    editor.setSelection(0);
    const fallbackFile = new File(["img"], "fallback.png", { type: "image/png" });
    content.dispatchEvent(makeDropEvent({ files: [fallbackFile], items: [] }));
    await flushMicrotasks();

    expect(editor.getDocument()).toBe(
      "![fallback.png](assets/drop.png)A![drop.png](assets/drop.png)B"
    );
    editor.destroy();
  });

  it("uploads a file batch serially and commits it as one undoable document change", async () => {
    const container = document.createElement("div");
    const firstUpload = createDeferred<string | null>();
    const secondUpload = createDeferred<string | null>();
    const firstFile = new File(["one"], "one.png", { type: "image/png" });
    const secondFile = new File(["two"], "two.pdf", { type: "application/pdf" });
    const uploads: File[] = [];
    let documentChanges = 0;
    const editor = createEditor({
      container,
      initialValue: "A",
      onAssetUpload(file) {
        uploads.push(file);
        return file === firstFile ? firstUpload.promise : secondUpload.promise;
      },
      plugins: [
        createHistoryPlugin(),
        {
          name: "count-document-changes",
          cmExtensions: [
            EditorView.updateListener.of((update) => {
              if (update.docChanged) documentChanges += 1;
            }),
          ],
        },
      ],
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    editor.setSelection(1);
    content.dispatchEvent(makePasteEvent({ files: [firstFile, secondFile], items: [] }));
    expect(uploads).toEqual([firstFile]);

    firstUpload.resolve("assets/one.png");
    await flushMicrotasks();
    expect(uploads).toEqual([firstFile, secondFile]);
    expect(editor.getDocument()).toBe("A");

    secondUpload.resolve("assets/two.pdf");
    await flushMicrotasks();
    expect(editor.getDocument()).toBe("A![one.png](assets/one.png)[two.pdf](assets/two.pdf)");
    expect(documentChanges).toBe(1);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("A");
    editor.destroy();
  });

  it("isolates individual upload failures and skips a batch when every upload fails", async () => {
    const partialContainer = document.createElement("div");
    const failedFile = new File(["bad"], "bad.png", { type: "image/png" });
    const goodFile = new File(["good"], "good.pdf", { type: "application/pdf" });
    const partialEditor = createEditor({
      container: partialContainer,
      initialValue: "A",
      onAssetUpload: (file) =>
        file === failedFile ? Promise.reject(new Error("upload failed")) : Promise.resolve("assets/good.pdf"),
    });
    const partialContent = partialContainer.querySelector("[contenteditable='true']") as HTMLElement;

    partialEditor.setSelection(1);
    partialContent.dispatchEvent(makePasteEvent({ files: [failedFile, goodFile], items: [] }));
    await flushMicrotasks();
    expect(partialEditor.getDocument()).toBe("A[good.pdf](assets/good.pdf)");
    partialEditor.destroy();

    const failedContainer = document.createElement("div");
    const failedEditor = createEditor({
      container: failedContainer,
      initialValue: "unchanged",
      onAssetUpload: () => Promise.reject(new Error("upload failed")),
    });
    const failedContent = failedContainer.querySelector("[contenteditable='true']") as HTMLElement;

    failedContent.dispatchEvent(makePasteEvent({ files: [failedFile], items: [] }));
    await flushMicrotasks();
    expect(failedEditor.getDocument()).toBe("unchanged");
    failedEditor.destroy();
  });

  it("maps concurrent asset batches independently when they resolve out of order", async () => {
    const container = document.createElement("div");
    const firstUpload = createDeferred<string | null>();
    const secondUpload = createDeferred<string | null>();
    const firstFile = new File(["one"], "one.png", { type: "image/png" });
    const secondFile = new File(["two"], "two.png", { type: "image/png" });
    const editor = createEditor({
      container,
      initialValue: "AB",
      onAssetUpload: (file) => (file === firstFile ? firstUpload.promise : secondUpload.promise),
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    editor.setSelection(1);
    content.dispatchEvent(makePasteEvent({ files: [firstFile], items: [] }));
    editor.setSelection(0);
    content.dispatchEvent(makePasteEvent({ files: [secondFile], items: [] }));

    secondUpload.resolve("assets/two.png");
    await flushMicrotasks();
    firstUpload.resolve("assets/one.png");
    await flushMicrotasks();

    expect(editor.getDocument()).toBe(
      "![two.png](assets/two.png)A![one.png](assets/one.png)B"
    );
    editor.destroy();
  });

  it("discards a pending asset result after the document is replaced", async () => {
    const container = document.createElement("div");
    const upload = createDeferred<string | null>();
    const editor = createEditor({
      container,
      initialValue: "old",
      onAssetUpload: () => upload.promise,
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    content.dispatchEvent(
      makePasteEvent({ files: [new File(["img"], "x.png", { type: "image/png" })], items: [] })
    );
    editor.setDocument("new");
    upload.resolve("assets/x.png");
    await flushMicrotasks();

    expect(editor.getDocument()).toBe("new");
    editor.destroy();
  });

  it("discards a pending asset result when setDocument is deferred by composition", async () => {
    const container = document.createElement("div");
    const upload = createDeferred<string | null>();
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      initialValue: "old",
      onAssetUpload: () => upload.promise,
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    content.dispatchEvent(
      makePasteEvent({ files: [new File(["img"], "x.png", { type: "image/png" })], items: [] })
    );
    view.contentDOM.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    editor.setDocument("new");
    upload.resolve("assets/x.png");
    await flushMicrotasks();

    expect(editor.getDocument()).toBe("old");
    view.contentDOM.dispatchEvent(new Event("compositionend", { bubbles: true }));
    expect(editor.getDocument()).toBe("new");
    editor.destroy();
  });

  it("does not start the default asset pipeline in a read-only editor", () => {
    const container = document.createElement("div");
    const uploads: File[] = [];
    const editor = createEditor({
      container,
      readOnly: true,
      onAssetUpload(file) {
        uploads.push(file);
        return Promise.resolve("assets/x.png");
      },
    });
    const content = container.querySelector(".cm-content") as HTMLElement;
    const event = makePasteEvent({
      files: [new File(["img"], "x.png", { type: "image/png" })],
      items: [],
    });

    content.dispatchEvent(event);

    expect(uploads).toEqual([]);
    expect(editor.getDocument()).toBe("");
    editor.destroy();
  });

  it("does not dispatch a pending asset result after the editor is destroyed", async () => {
    const container = document.createElement("div");
    const upload = createDeferred<string | null>();
    const firstFile = new File(["first"], "first.png", { type: "image/png" });
    const secondFile = new File(["second"], "second.png", { type: "image/png" });
    const uploads: File[] = [];
    let capturedView: EditorView | null = null;
    const editor = createEditor({
      container,
      onAssetUpload(file) {
        uploads.push(file);
        return upload.promise;
      },
      plugins: [{ name: "capture", cmExtensions: [captureViewPlugin((view) => (capturedView = view))] }],
    });
    const view = requireEditorView(capturedView);
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    content.dispatchEvent(makePasteEvent({ files: [firstFile, secondFile], items: [] }));
    editor.destroy();
    const dispatch = vi.spyOn(view, "dispatch");
    upload.resolve("assets/first.png");
    await flushMicrotasks();

    expect(uploads).toEqual([firstFile]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not route plain-text paste through the asset pipeline", () => {
    const container = document.createElement("div");
    const uploads: File[] = [];
    const editor = createEditor({
      container,
      onAssetUpload: (file) => {
        uploads.push(file);
        return Promise.resolve("uploaded");
      },
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    // 纯文本粘贴（无 files/items）交回 CodeMirror，绝不触发资源上传。
    const event = makePasteEvent({ files: [], items: [], getData: () => "plain text" });
    content.dispatchEvent(event);

    expect(uploads).toEqual([]);
    editor.destroy();
  });

  it("dispatches keydown to plugin handlers and stops default only when consumed", () => {
    const container = document.createElement("div");
    const keys: string[] = [];
    const editor = createEditor({
      container,
      plugins: [
        {
          name: "keydown-hook",
          handlers: {
            keydown: (event) => {
              keys.push(event.key);
              return event.key === "F2";
            },
          },
        },
      ],
    });
    const content = container.querySelector("[contenteditable='true']") as HTMLElement;

    const handled = new KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true });
    content.dispatchEvent(handled);
    expect(keys).toContain("F2");
    expect(handled.defaultPrevented).toBe(true);

    const passthrough = new KeyboardEvent("keydown", { key: "F3", bubbles: true, cancelable: true });
    content.dispatchEvent(passthrough);
    expect(passthrough.defaultPrevented).toBe(false);
    editor.destroy();
  });
});
