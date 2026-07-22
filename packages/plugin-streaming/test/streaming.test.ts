import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  createStreamingExtension,
  StreamingManager,
  streamingSessionField,
} from "../src/streaming-plugin";

function createView(initialDoc: string = ""): EditorView {
  const state = EditorState.create({
    doc: initialDoc,
    extensions: [createStreamingExtension({ autoScroll: false })],
  });
  return new EditorView({ state });
}

describe("plugin-streaming", () => {
  it("initializes with inactive streaming state", () => {
    const view = createView("Hello world");
    const session = view.state.field(streamingSessionField);

    expect(session.active).toBe(false);
    expect(session.sessionId).toBeNull();
    expect(session.text).toBe("");
  });

  it("starts a streaming session at specified position", () => {
    const view = createView("Hello world");
    const manager = new StreamingManager({ autoScroll: false });

    manager.startStream(view, "stream-1", 5);
    const session = view.state.field(streamingSessionField);

    expect(session.active).toBe(true);
    expect(session.sessionId).toBe("stream-1");
    expect(session.startPos).toBe(5);
    expect(session.currentPos).toBe(5);
  });

  it("appends streaming token chunks sequentially", () => {
    const view = createView("Base: ");
    const manager = new StreamingManager({ autoScroll: false });

    manager.startStream(view, "stream-1", 6);
    manager.appendChunk(view, "stream-1", "Hello ");
    manager.appendChunk(view, "stream-1", "AI!");

    const session = view.state.field(streamingSessionField);
    expect(session.text).toBe("Hello AI!");
    expect(session.currentPos).toBe(15);
    expect(view.state.doc.toString()).toBe("Base: Hello AI!");
  });

  it("finishes streaming session clean up", () => {
    const view = createView("Doc: ");
    const manager = new StreamingManager({ autoScroll: false });

    manager.startStream(view, "stream-1", 5);
    manager.appendChunk(view, "stream-1", "Generated Content");

    const finishedState = manager.finishStream(view, "stream-1");

    expect(finishedState.text).toBe("Generated Content");

    const sessionAfter = view.state.field(streamingSessionField);
    expect(sessionAfter.active).toBe(false);
    expect(sessionAfter.sessionId).toBeNull();
    expect(view.state.doc.toString()).toBe("Doc: Generated Content");
  });

  it("ignores append operations for invalid session ID", () => {
    const view = createView("Start: ");
    const manager = new StreamingManager({ autoScroll: false });

    manager.startStream(view, "stream-active", 7);
    manager.appendChunk(view, "stream-wrong", "Text should not append");

    const session = view.state.field(streamingSessionField);
    expect(session.text).toBe("");
    expect(view.state.doc.toString()).toBe("Start: ");
  });
});
