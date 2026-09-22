import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { createEditor } from "@floatboat/nexus-core";
import {
  createCollabPlugin,
  linkDocs,
  LocalBroadcastProvider,
  setUserAwareness,
  getRandomUserPalette,
  DEFAULT_USER_PALETTES,
} from "../src/index";

describe("@floatboat/nexus-plugin-collab", () => {
  it("synchronizes document changes between editor and Y.Text", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("codemirror");
    const container = document.createElement("div");

    const editor = createEditor({
      container,
      initialValue: "Initial content",
      plugins: [createCollabPlugin({ ytext, initialValue: "Initial content" })],
    });

    // Editor content should sync to ytext
    expect(ytext.toString()).toBe("Initial content");

    // Modifying ytext should reflect in editor
    ytext.insert(ytext.length, " appended");
    expect(editor.getDocument()).toBe("Initial content appended");

    editor.destroy();
  });

  it("synchronizes two editor instances in real time without conflicts", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const ytextA = docA.getText("content");
    const ytextB = docB.getText("content");

    const containerA = document.createElement("div");
    const containerB = document.createElement("div");

    const editorA = createEditor({
      container: containerA,
      initialValue: "Start",
      plugins: [createCollabPlugin({ ytext: ytextA, initialValue: "Start" })],
    });

    const unlink = linkDocs(docA, docB);

    const editorB = createEditor({
      container: containerB,
      initialValue: ytextB.toString(),
      plugins: [createCollabPlugin({ ytext: ytextB })],
    });

    // Initial state synchronized
    expect(editorB.getDocument()).toBe("Start");

    // Editor A updates document
    editorA.replaceSelection(" Updated by A");
    expect(editorB.getDocument()).toContain("Updated by A");

    // Editor B updates document
    editorB.setSelection(editorB.getDocument().length);
    editorB.replaceSelection(" and B");

    expect(editorA.getDocument()).toBe(editorB.getDocument());
    expect(editorA.getDocument()).toContain("and B");

    unlink();
    editorA.destroy();
    editorB.destroy();
  });

  it("handles awareness user presence configuration", () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);

    setUserAwareness(awareness, {
      name: "Alice",
      color: "#2563eb",
    });

    const localState = awareness.getLocalState();
    expect(localState?.user?.name).toBe("Alice");
    expect(localState?.user?.color).toBe("#2563eb");
  });

  it("picks random palette when user color is not specified", () => {
    const palette = getRandomUserPalette();
    expect(DEFAULT_USER_PALETTES).toContainEqual(palette);
  });

  it("manages LocalBroadcastProvider lifecycle safely", () => {
    const ydoc = new Y.Doc();
    const provider = new LocalBroadcastProvider("test-room", ydoc);

    expect(provider.room).toBe("test-room");
    expect(() => provider.destroy()).not.toThrow();
  });

  it("supports collaborative undo manager", () => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("undo-test");
    const undoManager = new Y.UndoManager(ytext);

    const container = document.createElement("div");
    const editor = createEditor({
      container,
      plugins: [createCollabPlugin({ ytext, undoManager })],
    });

    ytext.insert(0, "First change");
    expect(editor.getDocument()).toBe("First change");

    undoManager.undo();
    expect(ytext.toString()).toBe("");
    expect(editor.getDocument()).toBe("");

    undoManager.redo();
    expect(editor.getDocument()).toBe("First change");

    editor.destroy();
  });
});
