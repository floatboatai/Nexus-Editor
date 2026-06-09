import type { Root } from "mdast";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { Plugin } from "unified";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "../src/index";

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

    expect(() => editor.setDocument("after-destroy")).not.toThrow();
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

const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

  it("getSelectedText returns the text within the current selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "Hello, world!" });

    // 无选区（光标状态）时返回空字符串
    expect(editor.getSelectedText()).toBe("");

    // 选中 "Hello"（位置 0-5）
    editor.setSelection(0, 5);
    expect(editor.getSelectedText()).toBe("Hello");

    // 选中 "world"（位置 7-12）
    editor.setSelection(7, 12);
    expect(editor.getSelectedText()).toBe("world");

    // 选中含标点 ", world!"（位置 5-13）
    editor.setSelection(5, 13);
    expect(editor.getSelectedText()).toBe(", world!");

    // 反向选区（anchor=5, head=0）选中位置 0-5，即 "Hello"
    editor.setSelection(5, 0);
    expect(editor.getSelectedText()).toBe("Hello");

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
