import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCalAgentManager } from "../electron/cal-agent-manager";

function createFakeChild() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  return {
    pid: 4321,
    once(event: string, cb: (...args: any[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
      return this;
    },
    emit(event: string, ...args: any[]) {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    },
    kill: vi.fn(() => true),
  };
}

describe("createCalAgentManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("transitions from starting to ready after the health probe succeeds", async () => {
    const child = createFakeChild();
    const spawn = vi.fn(() => child as any);
    const probeUrl = vi
      .fn<(url: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const manager = createCalAgentManager({
      spawn,
      probeUrl,
      pollIntervalMs: 100,
      startupTimeoutMs: 1000,
      command: "npm",
      args: ["run", "web:dev"],
      cwd: "/Users/wangqiao/workspace/CAL-AGENT",
      url: "http://127.0.0.1:3000",
    });

    const startPromise = manager.start();
    await vi.advanceTimersByTimeAsync(200);

    await expect(startPromise).resolves.toMatchObject({ status: "ready" });
    expect(manager.getStatus().status).toBe("ready");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("does not spawn a second child while already starting", () => {
    const child = createFakeChild();
    const spawn = vi.fn(() => child as any);

    const manager = createCalAgentManager({
      spawn,
      probeUrl: vi.fn(() => new Promise<boolean>(() => {})),
      pollIntervalMs: 100,
      startupTimeoutMs: 5000,
      command: "npm",
      args: ["run", "web:dev"],
      cwd: "/Users/wangqiao/workspace/CAL-AGENT",
      url: "http://127.0.0.1:3000",
    });

    void manager.start();
    void manager.start();

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("moves to error on startup timeout and allows retry", async () => {
    const firstChild = createFakeChild();
    const secondChild = createFakeChild();
    const spawn = vi
      .fn()
      .mockReturnValueOnce(firstChild as any)
      .mockReturnValueOnce(secondChild as any);
    const probeUrl = vi.fn<(url: string) => Promise<boolean>>().mockResolvedValue(false);

    const manager = createCalAgentManager({
      spawn,
      probeUrl,
      pollIntervalMs: 100,
      startupTimeoutMs: 300,
      command: "npm",
      args: ["run", "web:dev"],
      cwd: "/Users/wangqiao/workspace/CAL-AGENT",
      url: "http://127.0.0.1:3000",
    });

    const first = manager.start();
    await vi.advanceTimersByTimeAsync(400);
    await expect(first).resolves.toMatchObject({ status: "error" });

    probeUrl.mockResolvedValueOnce(true);
    const retry = manager.retry();
    await vi.advanceTimersByTimeAsync(100);
    await expect(retry).resolves.toMatchObject({ status: "ready" });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("moves to error when the child exits before readiness", async () => {
    const child = createFakeChild();
    const spawn = vi.fn(() => child as any);

    const manager = createCalAgentManager({
      spawn,
      probeUrl: vi.fn<(url: string) => Promise<boolean>>().mockResolvedValue(false),
      pollIntervalMs: 100,
      startupTimeoutMs: 5000,
      command: "npm",
      args: ["run", "web:dev"],
      cwd: "/Users/wangqiao/workspace/CAL-AGENT",
      url: "http://127.0.0.1:3000",
    });

    const startPromise = manager.start();
    child.emit("exit", 1);

    await expect(startPromise).resolves.toMatchObject({ status: "error" });
    expect(manager.getStatus().status).toBe("error");
  });
});