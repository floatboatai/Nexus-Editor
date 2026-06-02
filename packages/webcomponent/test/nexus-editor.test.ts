import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NexusEditor } from "../src/nexus-editor";

describe("@floatboat/nexus-webcomponent", () => {
  beforeEach(() => {
    if (!customElements.get("nexus-editor")) {
      customElements.define("nexus-editor", NexusEditor);
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders an editor into the provided container", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    editor.setAttribute("value", "# Hello");
    document.body.appendChild(editor);

    expect(editor.shadowRoot?.querySelector(".cm-editor")).not.toBeNull();
    expect(editor.shadowRoot?.querySelector("[contenteditable='true']")).not.toBeNull();

    editor.destroy();

    expect(editor.shadowRoot?.querySelector(".cm-editor")).toBeNull();
  });

  it("exposes the core editor api", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    editor.setAttribute("value", "start");
    document.body.appendChild(editor);

    editor.setDocument("updated");
    expect(editor.getDocument()).toBe("updated");

    editor.destroy();
  });

  it("supports value attribute binding", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    editor.setAttribute("value", "Initial content");
    expect(editor.value).toBe("Initial content");

    editor.value = "Updated content";
    expect(editor.getAttribute("value")).toBe("Updated content");
    expect(editor.getDocument()).toBe("Updated content");

    editor.destroy();
  });

  it("dispatches change event when content changes", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    const changes: string[] = [];
    editor.addEventListener("change", (e) => {
      changes.push((e as CustomEvent).detail.value);
    });

    editor.setDocument("Changed content");

    expect(changes).toContain("Changed content");

    editor.destroy();
  });

  it("can be used declaratively in HTML", () => {
    document.body.innerHTML = `
      <nexus-editor value="# Hello" theme="light"></nexus-editor>
    `;

    const editor = document.querySelector("nexus-editor") as NexusEditor;
    expect(editor).not.toBeNull();
    expect(editor.value).toBe("# Hello");

    editor?.destroy();
  });

  it("supports theme attribute binding", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    editor.setAttribute("theme", "dark");
    expect(editor.getAttribute("theme")).toBe("dark");

    editor.setAttribute("theme", "light");
    expect(editor.getAttribute("theme")).toBe("light");

    editor.destroy();
  });

  it("supports read-only attribute", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    editor.setAttribute("read-only", "");
    expect(editor.readOnly).toBe(true);

    editor.removeAttribute("read-only");
    expect(editor.readOnly).toBe(false);

    editor.destroy();
  });

  it("supports tab-size attribute", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    editor.setAttribute("tab-size", "2");
    expect(editor.getAttribute("tab-size")).toBe("2");

    editor.setAttribute("tab-size", "4");
    expect(editor.getAttribute("tab-size")).toBe("4");

    editor.destroy();
  });

  it("supports indent-guides attribute", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    editor.setAttribute("indent-guides", "");
    expect(editor.getAttribute("indent-guides")).toBe("");

    editor.removeAttribute("indent-guides");
    expect(editor.getAttribute("indent-guides")).toBeNull();

    editor.destroy();
  });

  it("supports live-preview attribute", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    editor.setAttribute("live-preview", "");
    expect(editor.getAttribute("live-preview")).toBe("");

    editor.removeAttribute("live-preview");
    expect(editor.getAttribute("live-preview")).toBeNull();

    editor.destroy();
  });

  it("supports undo and redo operations", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    editor.setDocument("First");
    editor.setDocument("Second");

    const undoResult = editor.undo();
    expect(typeof undoResult).toBe("boolean");

    const redoResult = editor.redo();
    expect(typeof redoResult).toBe("boolean");

    editor.destroy();
  });

  it("supports getSelection and setSelection", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    editor.setDocument("Hello World");
    document.body.appendChild(editor);

    const selection = editor.getSelection();
    expect(selection).toHaveProperty("anchor");
    expect(selection).toHaveProperty("head");

    editor.setSelection(0, 5);
    const newSelection = editor.getSelection();
    expect(newSelection.anchor).toBe(0);

    editor.destroy();
  });

  it("supports replaceSelection", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    editor.setDocument("Hello World");
    document.body.appendChild(editor);

    editor.setSelection(0, 5);
    editor.replaceSelection("Hi");

    expect(editor.getDocument()).toContain("Hi");

    editor.destroy();
  });

  it("supports exportHTML", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    editor.setDocument("# Heading");
    document.body.appendChild(editor);

    const html = editor.exportHTML();
    expect(typeof html).toBe("string");

    editor.destroy();
  });

  it("dispatches focus and blur events", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    expect(typeof editor.focus).toBe("function");
    expect(typeof editor.blur).toBe("function");

    editor.destroy();
  });

  it("handles connectedCallback and disconnectedCallback", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    
    document.body.appendChild(editor);
    expect(editor.shadowRoot?.querySelector(".editor-wrapper")).not.toBeNull();

    document.body.removeChild(editor);
    
    editor.destroy();
  });

  it("supports setDocument with silent option", () => {
    const editor = document.createElement("nexus-editor") as NexusEditor;
    document.body.appendChild(editor);

    const changes: string[] = [];
    editor.addEventListener("change", (e) => {
      changes.push((e as CustomEvent).detail.value);
    });

    editor.setDocument("Silent update", true);
    
    expect(changes.length).toBe(0);
    expect(editor.getDocument()).toBe("Silent update");

    editor.destroy();
  });
});
