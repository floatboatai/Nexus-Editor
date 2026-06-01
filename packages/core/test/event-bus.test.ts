import { describe, it, expect, vi } from "vitest";
import { EventBus, setGlobalErrorHandler } from "../src/event-bus";

interface TestEvents {
  test: (value: string) => void;
  numeric: (n: number) => void;
  empty: () => void;
}

describe("EventBus", () => {
  // -----------------------------------------------------------------------
  // Basic on/off/emit
  // -----------------------------------------------------------------------

  it("emits to subscribed handlers", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("test", fn);
    bus.emit("test", "hello");
    expect(fn).toHaveBeenCalledWith("hello");
  });

  it("does not emit to unsubscribed handlers", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("test", fn);
    bus.off("test", fn);
    bus.emit("test", "hello");
    expect(fn).not.toHaveBeenCalled();
  });

  it("supports multiple handlers for the same event", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("test", a);
    bus.on("test", b);
    bus.emit("test", "x");
    expect(a).toHaveBeenCalledWith("x");
    expect(b).toHaveBeenCalledWith("x");
  });

  it("supports multiple arguments per event", () => {
    const bus = new EventBus<{ multi: (a: string, b: number) => void }>();
    const fn = vi.fn();
    bus.on("multi", fn);
    bus.emit("multi", "test", 42);
    expect(fn).toHaveBeenCalledWith("test", 42);
  });

  it("clears all handlers", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("test", fn);
    bus.clear();
    bus.emit("test", "x");
    expect(fn).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // once()
  // -----------------------------------------------------------------------

  it("fires once() handlers only once", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.once("test", fn);
    bus.emit("test", "a");
    bus.emit("test", "b");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("supports multiple once() handlers on the same event", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();
    bus.once("test", a);
    bus.once("test", b);
    bus.emit("test", "x");
    bus.emit("test", "y");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("once() handlers removed via off() never fire", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.once("test", fn);
    bus.off("test", fn);
    bus.emit("test", "x");
    expect(fn).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Priority
  // -----------------------------------------------------------------------

  it("calls handlers in priority order (higher first)", () => {
    const bus = new EventBus<TestEvents>();
    const order: number[] = [];
    bus.on("test", () => order.push(1), { priority: 10 });
    bus.on("test", () => order.push(2), { priority: 20 });
    bus.on("test", () => order.push(3), { priority: 0 });
    bus.emit("test", "x");
    expect(order).toEqual([2, 1, 3]);
  });

  it("preserves insertion order for equal-priority handlers", () => {
    const bus = new EventBus<TestEvents>();
    const order: number[] = [];
    bus.on("test", () => order.push(1));
    bus.on("test", () => order.push(2));
    bus.on("test", () => order.push(3));
    bus.emit("test", "x");
    expect(order).toEqual([1, 2, 3]);
  });

  // -----------------------------------------------------------------------
  // Error isolation
  // -----------------------------------------------------------------------

  it("isolates errors so other handlers still fire", () => {
    const bus = new EventBus<TestEvents>();
    const good = vi.fn();
    const bad = () => { throw new Error("boom"); };
    bus.on("test", good);
    bus.on("test", bad);
    expect(() => bus.emit("test", "x")).not.toThrow();
    expect(good).toHaveBeenCalledWith("x");
  });

  it("forwards errors to global error handler", () => {
    const bus = new EventBus<TestEvents>();
    const handler = vi.fn();
    setGlobalErrorHandler(handler);

    const bad = () => { throw new Error("boom"); };
    bus.on("test", bad);
    bus.emit("test", "x");

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][1].message).toBe("boom");
    setGlobalErrorHandler(null);
  });

  // -----------------------------------------------------------------------
  // Pause / Resume
  // -----------------------------------------------------------------------

  it("pauses and queues events, replaying on resume", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("test", fn);

    bus.pause();
    bus.emit("test", "a");
    bus.emit("test", "b");
    expect(fn).not.toHaveBeenCalled(); // queued

    bus.resume();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "a");
    expect(fn).toHaveBeenNthCalledWith(2, "b");
  });

  it("resume flushes only once (idempotent)", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("test", fn);

    bus.pause();
    bus.emit("test", "a");
    bus.resume();
    fn.mockClear();

    // Second resume should be a no-op
    bus.resume();
    expect(fn).not.toHaveBeenCalled();
  });

  it("pause returns a flush function", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("test", fn);

    const flush = bus.pause();
    bus.emit("test", "a");
    expect(fn).not.toHaveBeenCalled();

    flush();
    expect(fn).toHaveBeenCalledWith("a");
  });

  // -----------------------------------------------------------------------
  // Wildcard "*"
  // -----------------------------------------------------------------------

  it("wildcard '*' receives all events", () => {
    const bus = new EventBus<TestEvents>();
    const wild = vi.fn();
    bus.on("*", wild);

    bus.emit("test", "hello");
    bus.emit("numeric", 42);

    expect(wild).toHaveBeenCalledTimes(2);
    expect(wild).toHaveBeenCalledWith("test", "hello");
    expect(wild).toHaveBeenCalledWith("numeric", 42);
  });

  it("wildcard handlers are isolated from errors", () => {
    const bus = new EventBus<TestEvents>();
    const good = vi.fn();
    const bad = () => { throw new Error("wild-boom"); };
    bus.on("*", bad);
    bus.on("test", good);

    expect(() => bus.emit("test", "x")).not.toThrow();
    expect(good).toHaveBeenCalledWith("x");
  });

  it("off() works on wildcard handlers", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("*", fn);
    bus.off("*", fn);
    bus.emit("test", "x");
    expect(fn).not.toHaveBeenCalled();
  });

  it("wildcard does not recursively fire on its own emit", () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    bus.on("*", spy);
    // Emitting '*' directly should call the wildcard handler once
    // (no recursion). The handler receives the raw args without the
    // event-name prefix since the event key equals WILDCARD.
    (bus as any).emit("*", "test");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("test");
  });

  // -----------------------------------------------------------------------
  // listenerCount
  // -----------------------------------------------------------------------

  it("listenerCount returns correct count", () => {
    const bus = new EventBus<TestEvents>();
    expect(bus.listenerCount("test")).toBe(0);

    const a = vi.fn();
    const b = vi.fn();
    bus.on("test", a);
    expect(bus.listenerCount("test")).toBe(1);
    bus.on("test", b);
    expect(bus.listenerCount("test")).toBe(2);
    bus.off("test", a);
    expect(bus.listenerCount("test")).toBe(1);
    bus.off("test", b);
    expect(bus.listenerCount("test")).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("does nothing when emitting to an event with no listeners", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit("empty")).not.toThrow();
  });

  it("does nothing when emitting to an event with only once-handlers that were already removed", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.once("test", fn);
    bus.emit("test", "a"); // consumed
    bus.emit("test", "b"); // should be no-op
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("handlers added during emission are not called for the current emit", () => {
    const bus = new EventBus<TestEvents>();
    const late = vi.fn();
    const early = vi.fn(() => {
      bus.on("test", late);
    });
    bus.on("test", early);
    bus.emit("test", "x");
    expect(early).toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled(); // added during emit
    // But should fire on the next emit
    bus.emit("test", "y");
    expect(late).toHaveBeenCalledWith("y");
  });

  it("remove handler during emission does not affect other handlers", () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn(() => {
      bus.off("test", a);
    });
    const c = vi.fn();
    bus.on("test", a);
    bus.on("test", b);
    bus.on("test", c);
    bus.emit("test", "x");
    expect(a).toHaveBeenCalled(); // snapshot already captured before removal
    expect(c).toHaveBeenCalled();
  });

  it("clear() during pause discards pending events", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("test", fn);

    bus.pause();
    bus.emit("test", "a");
    bus.clear();
    bus.resume();

    expect(fn).not.toHaveBeenCalled();
  });

  it("empty event emits", () => {
    const bus = new EventBus<TestEvents>();
    const fn = vi.fn();
    bus.on("empty", fn);
    bus.emit("empty");
    expect(fn).toHaveBeenCalledOnce();
  });
});
