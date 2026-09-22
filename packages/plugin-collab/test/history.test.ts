import { afterEach, describe, expect, it } from "vitest";
import { Transaction } from "@codemirror/state";
import * as Y from "yjs";

import { mount, Network } from "./helpers";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((cleanup) => cleanup()));

function peers() {
  const network = new Network(2, "hello");
  cleanups.push(() => network.destroy());
  const alice = mount(network.text(0));
  const bob = mount(network.text(1));
  cleanups.push(() => alice.destroy(), () => bob.destroy());
  return { network, alice, bob };
}

describe("selective collaboration history", () => {
  it("replicates history-excluded changes without putting them in undo", () => {
    const { network, alice, bob } = peers();
    alice.view.dispatch({ changes: { from: 0, insert: "system " }, annotations: Transaction.addToHistory.of(false) });
    network.flush();
    expect(bob.editor.getDocument()).toBe("system hello");
    expect(alice.editor.undo()).toBe(false);
    alice.editor.replaceRange(0, 0, "local ");
    alice.editor.undo();
    expect(alice.editor.getDocument()).toBe("system hello");
  });
  it("undoes and redoes only local operations after a remote insertion", () => {
    const { network, alice, bob } = peers();
    alice.editor.replaceRange(5, 5, " Alice");
    network.flush();
    bob.editor.replaceRange(0, 0, "Bob ");
    network.flush();
    expect(alice.editor.undo()).toBe(true);
    network.flush();
    expect(alice.editor.getDocument()).toBe("Bob hello");
    expect(bob.editor.getDocument()).toBe("Bob hello");
    expect(alice.editor.undo()).toBe(false);
    expect(alice.editor.redo()).toBe(true);
    network.flush();
    expect(bob.editor.getDocument()).toBe("Bob hello Alice");
    expect(bob.editor.undo()).toBe(true);
    network.flush();
    expect(alice.editor.getDocument()).toBe("hello Alice");
  });

  it("restores a relative selection after remote edits shift its absolute offset", () => {
    const { network, alice, bob } = peers();
    alice.editor.setSelection(5);
    alice.editor.replaceSelection("!");
    network.flush();
    bob.editor.replaceRange(0, 0, "before ");
    network.flush();
    alice.editor.undo();
    expect(alice.editor.getSelection()).toEqual({ anchor: 12, head: 12 });
    alice.editor.redo();
    expect(alice.editor.getDocument()).toBe("before hello!");
    expect(alice.editor.getSelection()).toEqual({ anchor: 13, head: 13 });
  });

  it("keeps independent undo origins for editors sharing the same Y.Doc", () => {
    const doc = new Y.Doc();
    cleanups.push(() => doc.destroy());
    const text = doc.getText("markdown");
    const alice = mount(text);
    const bob = mount(text);
    cleanups.push(() => alice.destroy(), () => bob.destroy());
    alice.editor.replaceRange(0, 0, "A");
    bob.editor.replaceRange(1, 1, "B");
    alice.editor.undo();
    expect(alice.editor.getDocument()).toBe("B");
    expect(bob.editor.getDocument()).toBe("B");
    expect(bob.editor.undo()).toBe(true);
    expect(text.toString()).toBe("");
    expect(alice.editor.redo()).toBe(true);
    expect(text.toString()).toBe("A");
  });

  it("does not undo host changes or initial content", () => {
    const { network, alice } = peers();
    network.text(0).insert(0, "host ");
    expect(alice.editor.undo()).toBe(false);
    alice.editor.replaceRange(0, 0, "local ");
    alice.editor.undo();
    expect(alice.editor.getDocument()).toBe("host hello");
  });

  it("groups edits until an explicit undo boundary", () => {
    const { alice } = peers();
    alice.editor.replaceRange(5, 5, "a");
    alice.editor.replaceRange(6, 6, "b");
    alice.editor.stopCapturing();
    alice.editor.replaceRange(7, 7, "c");
    alice.editor.undo();
    expect(alice.editor.getDocument()).toBe("helloab");
    alice.editor.undo();
    expect(alice.editor.getDocument()).toBe("hello");
  });

  it("routes keyboard and native history input to the same backend", () => {
    const { alice } = peers();
    alice.editor.replaceRange(5, 5, "!");
    alice.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
      key: "z", ctrlKey: true, bubbles: true, cancelable: true,
    }));
    expect(alice.editor.getDocument()).toBe("hello");
    const redo = new InputEvent("beforeinput", { inputType: "historyRedo", bubbles: true, cancelable: true });
    alice.view.contentDOM.dispatchEvent(redo);
    expect(redo.defaultPrevented).toBe(true);
    expect(alice.editor.getDocument()).toBe("hello!");
    alice.view.contentDOM.dispatchEvent(new InputEvent("beforeinput", {
      inputType: "historyUndo", bubbles: true, cancelable: true,
    }));
    expect(alice.editor.getDocument()).toBe("hello");
  });

  it("restores multiple selections through undo", () => {
    const doc = new Y.Doc();
    doc.getText().insert(0, "ab cd");
    const client = mount(doc.getText(), { multiCursor: true });
    cleanups.push(() => doc.destroy(), () => client.destroy());
    client.editor.setSelections([{ anchor: 2 }, { anchor: 5 }], 0);
    client.editor.replaceSelection("!");
    expect(client.editor.getDocument()).toBe("ab! cd!");
    client.editor.undo();
    expect(client.editor.getSelections()).toEqual({
      ranges: [{ anchor: 2, head: 2 }, { anchor: 5, head: 5 }], mainIndex: 0,
    });
  });
});
