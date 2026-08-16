import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebouncedTask } from "../src/scheduler";

describe("createDebouncedTask", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not run before the delay elapses", () => {
    const run = vi.fn();
    const task = createDebouncedTask({ delay: 100, run });
    task.schedule();
    vi.advanceTimersByTime(99);
    expect(run).not.toHaveBeenCalled();
    expect(task.pending).toBe(true);
  });

  it("runs exactly once after the delay", () => {
    const run = vi.fn();
    const task = createDebouncedTask({ delay: 100, run });
    task.schedule();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
    expect(task.pending).toBe(false);
  });

  it("collapses repeated schedules within the window into a single run", () => {
    const run = vi.fn();
    const task = createDebouncedTask({ delay: 100, run });
    for (let i = 0; i < 5; i++) {
      task.schedule();
      vi.advanceTimersByTime(50);
    }
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("flush() runs immediately and reports true", async () => {
    const run = vi.fn();
    const task = createDebouncedTask({ delay: 1000, run });
    task.schedule();
    const flushed = await task.flush();
    expect(flushed).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(task.pending).toBe(false);
  });

  it("flush() returns false when nothing is pending", async () => {
    const run = vi.fn();
    const task = createDebouncedTask({ delay: 100, run });
    expect(await task.flush()).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("cancel() prevents a pending run", () => {
    const run = vi.fn();
    const task = createDebouncedTask({ delay: 100, run });
    task.schedule();
    task.cancel();
    vi.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();
    expect(task.pending).toBe(false);
  });

  it("reports running while an async run is in flight", async () => {
    let resolveRun!: () => void;
    const run = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRun = resolve;
        })
    );
    const task = createDebouncedTask({ delay: 0, run });
    task.schedule();
    await vi.advanceTimersByTimeAsync(0);
    expect(task.running).toBe(true);
    resolveRun();
    await vi.waitFor(() => expect(task.running).toBe(false));
  });

  it("awaits async work started by flush()", async () => {
    const order: string[] = [];
    const run = vi.fn(() => {
      order.push("run");
      return Promise.resolve().then(() => {
        order.push("done");
      });
    });
    const task = createDebouncedTask({ delay: 500, run });
    task.schedule();
    await task.flush();
    expect(order).toEqual(["run", "done"]);
  });

  it("delay of 0 still defers to the next macrotask", async () => {
    const run = vi.fn();
    const task = createDebouncedTask({ delay: 0, run });
    task.schedule();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("destroy() prevents further runs and flush reports false", async () => {
    const run = vi.fn();
    const task = createDebouncedTask({ delay: 100, run });
    task.schedule();
    task.destroy();
    vi.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();
    expect(await task.flush()).toBe(false);
  });
});
