import { describe, expect, it, vi } from "vitest";
import { createWorkerExecutor, type WorkerResponse } from "../src/worker-executor";

const request = {
  document: { id: "a", path: "A.md", version: "1" },
  content: "x", query: { text: "x" }, offset: 0, limit: 1,
};

describe("worker executor ownership", () => {
  it("is lazy and removes callbacks when aborted", async () => {
    const stopListening = vi.fn();
    const terminate = vi.fn();
    const factory = vi.fn(() => ({ postMessage() {}, listen: () => stopListening, terminate }));
    const executor = createWorkerExecutor(factory);
    expect(factory).not.toHaveBeenCalled();
    const controller = new AbortController();
    const scan = executor.scan(request, { signal: controller.signal });
    controller.abort();
    await expect(scan).rejects.toMatchObject({ code: "aborted" });
    await executor.dispose();
    expect(stopListening).toHaveBeenCalledOnce();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("ignores stale messages and disposes a worker after a completed result", async () => {
    let message: ((data: WorkerResponse) => void) | undefined;
    const terminate = vi.fn();
    const executor = createWorkerExecutor(() => ({
      postMessage() {},
      listen: (onMessage) => { message = onMessage; return () => undefined; },
      terminate,
    }));
    let completed = false;
    const result = { hits: [], nextOffset: null, elapsed: 1 };
    const scan = executor.scan(request, { signal: new AbortController().signal }).then((value) => { completed = true; return value; });
    message?.({ id: 0, ok: true, result });
    await Promise.resolve();
    expect(completed).toBe(false);
    message?.({ id: 1, ok: true, result });
    expect(await scan).toEqual(result);
    await executor.dispose();
    expect(terminate).toHaveBeenCalledOnce();
  });

  it("reports termination failures from disposal instead of dropping cleanup errors", async () => {
    const executor = createWorkerExecutor(() => ({
      postMessage() {}, listen: () => () => undefined,
      terminate: async () => { throw new Error("termination failed"); },
    }));
    const controller = new AbortController();
    const scan = executor.scan(request, { signal: controller.signal });
    controller.abort();
    await expect(scan).rejects.toMatchObject({ code: "aborted" });
    await expect(executor.dispose()).rejects.toThrow("cleanup failed");
  });
});
