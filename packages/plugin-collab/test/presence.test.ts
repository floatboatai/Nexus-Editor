import { afterEach, describe, expect, it, vi } from "vitest";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";

import { createCollaborativeEditor } from "../src/index";
import { mount, Network } from "./helpers";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).reverse().forEach((cleanup) => cleanup()));

function presence() {
  const network = new Network(2, "hello world");
  const local = new Awareness(network.docs[0]);
  const remote = new Awareness(network.docs[1]);
  const client = mount(network.text(0), { awareness: local });
  cleanups.push(() => network.destroy(), () => local.destroy(), () => remote.destroy(), () => client.destroy());
  const publish = () => applyAwarenessUpdate(local, encodeAwarenessUpdate(remote, [remote.clientID]), "test");
  const cursor = (anchor: number, head = anchor) => ({
    anchor: Y.createRelativePositionFromTypeIndex(network.text(1), anchor),
    head: Y.createRelativePositionFromTypeIndex(network.text(1), head),
  });
  return { network, local, remote, client, publish, cursor };
}

describe("collaborative presence", () => {
  it("renders remote selections with safe labels and colors", async () => {
    const { remote, client, publish, cursor } = presence();
    remote.setLocalState({
      user: { name: "<img src=x onerror=alert(1)>", color: "red; position:fixed" },
      cursor: cursor(1, 4),
    });
    publish();
    await Promise.resolve();
    expect(client.container.querySelector(".nexus-collab-selection")?.textContent).toBe("ell");
    expect(client.container.querySelector(".nexus-collab-name")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(client.container.querySelector(".nexus-collab-name img")).toBeNull();
    expect(client.container.querySelector<HTMLElement>(".nexus-collab-caret")?.style.borderColor).toBe("rgb(79, 70, 229)");
  });

  it("ignores invalid and unrelated relative positions", async () => {
    const { network, remote, client, publish } = presence();
    for (const cursor of [
      { anchor: null, head: 5 },
      { anchor: { item: { client: "bad" } }, head: {} },
      {
        anchor: Y.createRelativePositionFromTypeIndex(network.docs[1].getText("other"), 0),
        head: Y.createRelativePositionFromTypeIndex(network.docs[1].getText("other"), 0),
      },
    ]) {
      remote.setLocalState({ cursor });
      publish();
      await Promise.resolve();
      expect(client.container.querySelector(".nexus-collab-caret")).toBeNull();
    }
  });

  it("maps relative selections through remote text updates and removes departed peers", async () => {
    const { network, remote, client, publish, cursor } = presence();
    remote.setLocalState({ cursor: cursor(6, 11) });
    publish();
    await Promise.resolve();
    network.text(1).insert(0, "before ");
    network.flush();
    expect(client.container.querySelector(".nexus-collab-selection")?.textContent).toBe("world");
    remote.setLocalState(null);
    publish();
    await Promise.resolve();
    expect(client.container.querySelector(".nexus-collab-caret")).toBeNull();
  });

  it("clears only its cursor and preserves host user state on destruction", () => {
    const { local, client } = presence();
    local.setLocalStateField("user", { name: "Alice" });
    client.editor.focus();
    client.editor.setSelection(3);
    expect(local.getLocalState()?.cursor).toBeTruthy();
    client.destroy();
    expect(local.getLocalState()?.cursor).toBeNull();
    expect(local.getLocalState()?.user).toEqual({ name: "Alice" });
    expect(local.doc.isDestroyed).toBe(false);
  });

  it("does not clear another editor's active cursor on shared awareness", () => {
    const { network, local, client } = presence();
    const other = mount(network.text(0), { awareness: local });
    cleanups.push(() => other.destroy());
    client.editor.focus();
    client.editor.setSelection(1);
    other.editor.focus();
    other.editor.setSelection(5);
    const activeCursor = local.getLocalState()?.cursor;
    client.destroy();
    expect(local.getLocalState()?.cursor).toEqual(activeCursor);
  });

  it("unsubscribes on repeated destruction without destroying host resources", async () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    cleanups.push(() => doc.destroy(), () => awareness.destroy());
    const text = doc.getText("markdown");
    const observe = vi.spyOn(text, "observe");
    const unobserve = vi.spyOn(text, "unobserve");
    const on = vi.spyOn(awareness, "on");
    const off = vi.spyOn(awareness, "off");
    const docOn = vi.spyOn(doc, "on");
    const docOff = vi.spyOn(doc, "off");
    for (let index = 0; index < 10; index++) {
      const client = mount(text, { awareness });
      client.editor.replaceRange(0, 0, "x");
      awareness.setLocalStateField("test", index);
      client.destroy();
      client.destroy();
    }
    await Promise.resolve();
    expect(observe).toHaveBeenCalledTimes(10);
    expect(unobserve.mock.calls).toEqual(observe.mock.calls);
    expect(off.mock.calls).toEqual(on.mock.calls);
    for (const [event, listener] of docOn.mock.calls) {
      expect(docOff.mock.calls).toContainEqual([event, listener]);
    }
    text.insert(0, "still alive");
    expect(doc.isDestroyed).toBe(false);
    expect(awareness.getLocalState()?.test).toBe(9);
  });

  it("rejects awareness owned by a different document", () => {
    const { network, remote } = presence();
    expect(() => createCollaborativeEditor({
      container: document.createElement("div"), text: network.text(0), awareness: remote,
    })).toThrow("same Y.Doc");
  });
});
