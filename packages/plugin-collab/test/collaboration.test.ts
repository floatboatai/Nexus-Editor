import { EditorState, Transaction } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createCollaborativeEditor } from "../src/index";
import { mount, Network } from "./helpers";

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); });

function peers(count = 2, initial = "hello") {
  const network = new Network(count, initial);
  cleanups.push(() => network.destroy());
  const clients = network.docs.map((_, index) => {
    const client = mount(network.text(index));
    cleanups.push(() => client.destroy());
    return client;
  });
  return { network, clients };
}

describe("collaborative Markdown", () => {
  it("normalizes split surrogate pairs and lone surrogate insertions atomically", () => {
    const { network, clients: [alice, bob] } = peers(2, "😀!");
    alice.editor.replaceRange(1, 2, "");
    network.flush();
    expect(alice.editor.getDocument()).toBe("\uFFFD!");
    expect(bob.editor.getDocument()).toBe("\uFFFD!");
    expect(alice.editor.undo()).toBe(true);
    expect(alice.editor.getDocument()).toBe("😀!");
    alice.editor.replaceRange(2, 2, "\uD800");
    network.flush(true, true);
    expect(alice.editor.getDocument()).toBe("😀\uFFFD!");
    expect(bob.editor.getDocument()).toBe(alice.editor.getDocument());
  });

  it("replicates silent replacements while suppressing only the local callback", () => {
    const { network, clients: [alice, bob] } = peers();
    const localChange = vi.fn();
    const remoteChange = vi.fn();
    alice.editor.on("change", localChange);
    bob.editor.on("change", remoteChange);
    alice.editor.setDocument("# Replacement", { silent: true });
    network.flush();
    expect(localChange).not.toHaveBeenCalled();
    expect(remoteChange).toHaveBeenCalledTimes(1);
    expect(bob.editor.getDocument()).toBe("# Replacement");
    expect(alice.editor.getAst().children[0].type).toBe("heading");
  });

  it("keeps CRDT state in sync through composition transactions and remote edits", () => {
    const { network, clients: [alice, bob] } = peers(2, "");
    alice.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    alice.view.dispatch({ changes: { from: 0, insert: "ni" }, userEvent: "input.type.compose" });
    network.flush();
    bob.editor.replaceRange(2, 2, " peer");
    network.flush();
    alice.view.dispatch({ changes: { from: 0, to: 2, insert: "你" }, userEvent: "input.type.compose" });
    alice.view.contentDOM.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    network.flush();
    expect(alice.editor.getDocument()).toBe("你 peer");
    expect(bob.editor.getDocument()).toBe("你 peer");
  });
  it("joins existing content without seeding, including an empty room", () => {
    const { network, clients } = peers(2, "# Shared\n\n你好 👩🏽‍💻\r\n");
    expect(network.messages).toHaveLength(0);
    expect(clients[0].editor.getDocument()).toBe(network.text(0).toString());
    expect(clients[1].editor.getAst().children[0].type).toBe("heading");
    const empty = peers(2, "");
    expect(empty.clients[0].editor.getDocument()).toBe("");
    expect(empty.network.messages).toHaveLength(0);
  });

  it("converges concurrent insertions and overlapping deletions with reordered duplicates", () => {
    const { network, clients: [alice, bob] } = peers(2, "abcdef");
    alice.editor.replaceRange(1, 4, "Alice");
    bob.editor.replaceRange(2, 5, "Bob");
    network.flush(true, true);
    expect(alice.editor.getDocument()).toBe(bob.editor.getDocument());
    expect(alice.editor.getDocument()).toContain("Alice");
    expect(alice.editor.getDocument()).toContain("Bob");
    expect(network.messages).toHaveLength(0);
    expect(alice.editor.getDocument()).toBe(network.text(0).toString());
  });

  it("recovers dropped messages through state-vector synchronization", () => {
    const { network, clients: [alice, bob] } = peers();
    alice.editor.replaceRange(0, 0, "offline A ");
    bob.editor.replaceRange(5, 5, " offline B");
    network.messages.length = 0;
    network.reconnect();
    expect(alice.editor.getDocument()).toBe("offline A hello offline B");
    expect(bob.editor.getDocument()).toBe(alice.editor.getDocument());
    alice.editor.replaceRange(0, 0, "online ");
    network.flush();
    expect(bob.editor.getDocument()).toBe(alice.editor.getDocument());
  });

  it("applies disjoint changes and multi-cursor edits as one CRDT transaction", () => {
    const { network, clients: [alice, bob] } = peers(2, "one two three");
    alice.view.dispatch({ changes: [{ from: 0, to: 3, insert: "1" }, { from: 8, to: 13, insert: "3" }] });
    expect(network.messages).toHaveLength(1);
    network.flush();
    expect(bob.editor.getDocument()).toBe("1 two 3");
    expect(alice.editor.undo()).toBe(true);
    network.flush();
    expect(bob.editor.getDocument()).toBe("one two three");
  });

  it("projects remote edits through change callbacks and AST without echo", () => {
    const { network, clients: [alice, bob] } = peers(2, "text");
    const changed = vi.fn();
    bob.editor.on("change", changed);
    alice.editor.replaceRange(0, 0, "# ");
    network.flush();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(bob.editor.getAst().children[0].type).toBe("heading");
    expect(network.messages).toHaveLength(0);
  });

  it("bypasses local vetoes only for committed remote changes, notifying observers", () => {
    const { network, clients: [alice, bob] } = peers();
    const filter = vi.fn(() => ({ action: "reject" as const }));
    const observed = vi.fn();
    bob.editor.getContributionSink().registerTransactionFilter("local-policy", filter);
    bob.editor.getContributionSink().registerUpdateListener("audit", observed);
    bob.editor.replaceRange(0, 0, "rejected");
    expect(bob.editor.getDocument()).toBe("hello");
    alice.editor.replaceRange(0, 0, "accepted ");
    network.flush();
    expect(bob.editor.getDocument()).toBe("accepted hello");
    expect(filter).toHaveBeenCalledTimes(1);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.calls[0][0].origin).toEqual(["collaboration:remote"]);
  });

  it("honors CodeMirror filters for local changes without diverging on remote changes", () => {
    const network = new Network(2);
    cleanups.push(() => network.destroy());
    const client = mount(network.text(0), {
      plugins: [{ name: "filter", cmExtensions: [EditorState.changeFilter.of(() => false)] }],
    });
    cleanups.push(() => client.destroy());
    client.editor.replaceRange(0, 0, "blocked");
    expect(network.text(0).toString()).toBe("");
    network.text(1).insert(0, "remote");
    network.flush();
    expect(client.editor.getDocument()).toBe("remote");
  });

  it("keeps read-only replicas up to date without allowing undo", () => {
    const network = new Network(2, "start");
    cleanups.push(() => network.destroy());
    const client = mount(network.text(0), { readOnly: true });
    cleanups.push(() => client.destroy());
    network.text(1).insert(0, "remote ");
    network.flush();
    expect(client.editor.getDocument()).toBe("remote start");
    expect(client.editor.undo()).toBe(false);
  });

  it("retains normal live preview while exposing table source for transactional editing", () => {
    const network = new Network(2, "# Title\n\n| A | B |\n| --- | --- |\n| x | y |\n");
    cleanups.push(() => network.destroy());
    const client = mount(network.text(0), { livePreview: true });
    cleanups.push(() => client.destroy());
    expect(client.container.querySelector(".nexus-table-wrapper")).toBeNull();
    expect(client.container.textContent).toContain("| A | B |");
    const from = client.editor.getDocument().indexOf("x |");
    client.editor.replaceRange(from, from + 1, "local");
    network.text(1).insert(0, "remote\n\n");
    network.flush(true, true);
    expect(client.editor.getDocument()).toBe(network.text(1).toString());
    expect(client.editor.getDocument()).toContain("| local | y |");
  });

  it("converges four replicas across deterministic edit and partition schedules", () => {
    const { network, clients } = peers(4, "Markdown\n");
    let seed = 173;
    const random = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    for (let step = 0; step < 160; step++) {
      const client = clients[random(clients.length)];
      const length = client.editor.getDocument().length;
      const from = random(length + 1);
      const to = Math.min(length, from + random(4));
      client.editor.replaceRange(from, to, ["中", "a", "\n", "", "👩🏽‍💻"][random(5)]);
      if (step % 13 === 0) network.flush(true, true);
      if (step % 29 === 0) { network.messages.length = 0; network.reconnect(); }
    }
    network.reconnect();
    const expected = network.text(0).toString();
    for (let index = 0; index < clients.length; index++) {
      expect(network.text(index).toString()).toBe(expected);
      expect(clients[index].editor.getDocument()).toBe(expected);
    }
  });

  it("rejects incompatible history and invalid document ownership before binding", () => {
    const doc = new Y.Doc();
    cleanups.push(() => doc.destroy());
    const container = document.createElement("div");
    expect(() => createCollaborativeEditor({ container, text: new Y.Text() })).toThrow("attached");
    expect(() => createCollaborativeEditor({ container, text: doc.getText(), captureTimeout: -1 })).toThrow("captureTimeout");
    expect(() => createCollaborativeEditor({ container, text: doc.getText(), plugins: [createHistoryPlugin()] })).toThrow("history");
    const rich = doc.getText("rich");
    rich.insertEmbed(0, { image: "example" });
    expect(() => createCollaborativeEditor({ container, text: rich })).toThrow("plain text");
  });
});
