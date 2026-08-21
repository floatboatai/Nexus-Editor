import { describe, expect, it, vi } from "vitest";

import { EventEmitter } from "../src/event-emitter";

type TestEventMap = {
  ready: () => void;
  message: (count: number, label: string) => void;
};

describe("EventEmitter", () => {
  it("routes typed arguments only to handlers for the emitted event", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const readyHandler = vi.fn<TestEventMap["ready"]>();
    const messageHandler = vi.fn<TestEventMap["message"]>();

    emitter.on("ready", readyHandler);
    emitter.on("message", messageHandler);
    emitter.emit("message", 2, "queued");

    expect(messageHandler).toHaveBeenCalledWith(2, "queued");
    expect(readyHandler).not.toHaveBeenCalled();
  });

  it("does not register the same handler more than once", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const handler = vi.fn<TestEventMap["ready"]>();

    emitter.on("ready", handler);
    emitter.on("ready", handler);
    emitter.emit("ready");

    expect(handler).toHaveBeenCalledOnce();
  });

  it("removes only the requested handler", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const removedHandler = vi.fn<TestEventMap["ready"]>();
    const retainedHandler = vi.fn<TestEventMap["ready"]>();

    emitter.on("ready", removedHandler);
    emitter.on("ready", retainedHandler);
    emitter.off("ready", removedHandler);
    emitter.emit("ready");

    expect(removedHandler).not.toHaveBeenCalled();
    expect(retainedHandler).toHaveBeenCalledOnce();
  });

  it("defers handlers added during emit until the next emission", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const calls: string[] = [];
    const addedHandler = vi.fn(() => calls.push("added"));
    const addingHandler = vi.fn(() => {
      calls.push("adding");
      emitter.on("ready", addedHandler);
    });

    emitter.on("ready", addingHandler);
    emitter.emit("ready");

    expect(calls).toEqual(["adding"]);

    emitter.emit("ready");

    expect(calls).toEqual(["adding", "adding", "added"]);
  });

  it("finishes the current emission when a handler removes another handler", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const calls: string[] = [];
    const removedHandler = vi.fn(() => calls.push("removed"));
    const removingHandler = vi.fn(() => {
      calls.push("removing");
      emitter.off("ready", removedHandler);
    });

    emitter.on("ready", removingHandler);
    emitter.on("ready", removedHandler);
    emitter.emit("ready");

    expect(calls).toEqual(["removing", "removed"]);

    emitter.emit("ready");

    expect(calls).toEqual(["removing", "removed", "removing"]);
  });

  it("clears handlers for every event", () => {
    const emitter = new EventEmitter<TestEventMap>();
    const readyHandler = vi.fn<TestEventMap["ready"]>();
    const messageHandler = vi.fn<TestEventMap["message"]>();

    emitter.on("ready", readyHandler);
    emitter.on("message", messageHandler);
    emitter.clear();
    emitter.emit("ready");
    emitter.emit("message", 1, "ignored");

    expect(readyHandler).not.toHaveBeenCalled();
    expect(messageHandler).not.toHaveBeenCalled();
  });
});
