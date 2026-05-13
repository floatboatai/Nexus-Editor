import type { Root } from "mdast";
import { EditorView } from "@codemirror/view";
import type { Plugin } from "unified";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "../src/index";

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

  it("returns selected text from the primary selection", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello **world**" });

    editor.setSelection(8, 13);

    expect(editor.getSelectedText()).toBe("world");
    editor.destroy();
  });

  it("returns selected text in document order for reversed selections", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(11, 6);

    expect(editor.getSelectedText()).toBe("world");
    editor.destroy();
  });

  it("returns an empty string when the selection is collapsed", () => {
    const container = document.createElement("div");
    const editor = createEditor({ container, initialValue: "hello world" });

    editor.setSelection(5);

    expect(editor.getSelectedText()).toBe("");
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
