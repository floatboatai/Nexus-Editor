import { describe, expect, it, vi } from "vitest";

import {
  createCollabUtilitySupervisor,
  type CollabUtilityChild,
  type CollabUtilityPort,
  type CollabUtilityRendererTarget,
} from "../electron/collab-utility-supervisor";

class FakeChild implements CollabUtilityChild {
  readonly messages: Array<{ message: unknown; ports: readonly CollabUtilityPort[] }> = [];
  readonly kill = vi.fn(() => true);
  private readonly listeners = new Map<string, Set<(...args: never[]) => void>>();

  on(event: "spawn" | "message" | "exit", listener: (...args: never[]) => void): this {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: "spawn" | "message" | "exit", listener: (...args: never[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  postMessage(message: unknown, ports: readonly CollabUtilityPort[] = []): void {
    this.messages.push({ message, ports });
  }

  emit(event: "spawn" | "message" | "exit", ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...values: unknown[]) => void)(...args);
    }
  }
}

function target(id: number): CollabUtilityRendererTarget & {
  readonly messages: Array<{ channel: string; message: unknown; ports: readonly CollabUtilityPort[] }>;
} {
  const messages: Array<{ channel: string; message: unknown; ports: readonly CollabUtilityPort[] }> = [];
  return {
    id,
    messages,
    isDestroyed: () => false,
    postMessage(channel, message, ports = []) {
      messages.push({ channel, message, ports });
    },
  };
}

describe("Electron collaboration utility-process supervisor", () => {
  it("transfers one private MessagePort pair only after the SQLite worker reports ready", async () => {
    const child = new FakeChild();
    let portSequence = 0;
    const supervisor = createCollabUtilitySupervisor({
      spawn: () => child,
      createChannel: () => ({
        port1: { id: `renderer-${++portSequence}`, close: vi.fn() },
        port2: { id: `worker-${portSequence}`, close: vi.fn() },
      }),
      readyTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
    });
    const renderer = target(17);
    const attached = supervisor.attach(renderer);

    child.emit("spawn");
    expect(child.messages).toEqual([]);
    child.emit("message", { type: "ready" });
    await attached;

    expect(child.messages).toEqual([{
      message: { type: "connect", rendererId: 17, generation: 1 },
      ports: [expect.objectContaining({ id: "worker-1" })],
    }]);
    expect(renderer.messages).toEqual([{
      channel: "nexus:collab-store:port",
      message: { generation: 1 },
      ports: [expect.objectContaining({ id: "renderer-1" })],
    }]);
    const closing = supervisor.close();
    child.emit("message", { type: "closed", ok: true });
    await closing;
  });

  it("restarts an exited worker and reconnects every surviving renderer with a fresh generation", async () => {
    const children: FakeChild[] = [];
    let portSequence = 0;
    const supervisor = createCollabUtilitySupervisor({
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("message", { type: "ready" });
        });
        return child;
      },
      createChannel: () => ({
        port1: { id: `renderer-${++portSequence}`, close: vi.fn() },
        port2: { id: `worker-${portSequence}`, close: vi.fn() },
      }),
      readyTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
      restartDelayMs: 0,
    });
    const first = target(1);
    const second = target(2);
    await Promise.all([supervisor.attach(first), supervisor.attach(second)]);
    expect(children).toHaveLength(1);
    expect(first.messages[0]?.message).toEqual({ generation: 1 });
    expect(second.messages[0]?.message).toEqual({ generation: 1 });

    children[0].emit("exit", 1);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    await vi.waitFor(() => expect(first.messages).toHaveLength(2));
    expect(first.messages[1]?.message).toEqual({ generation: 2 });
    expect(second.messages[1]?.message).toEqual({ generation: 2 });

    supervisor.detach(first.id);
    const closing = supervisor.close();
    children[1]?.emit("message", { type: "closed", ok: true });
    await closing;
  });

  it("waits for graceful worker shutdown and never restarts during application close", async () => {
    const child = new FakeChild();
    let spawnCount = 0;
    const supervisor = createCollabUtilitySupervisor({
      spawn: () => {
        spawnCount += 1;
        queueMicrotask(() => {
          child.emit("spawn");
          child.emit("message", { type: "ready" });
        });
        return child;
      },
      createChannel: () => ({
        port1: { close: vi.fn() },
        port2: { close: vi.fn() },
      }),
      readyTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
    });
    await supervisor.attach(target(3));
    const closing = supervisor.close();
    expect(child.messages.at(-1)?.message).toEqual({ type: "shutdown" });
    child.emit("message", { type: "closed", ok: true });
    child.emit("exit", 0);
    await closing;

    expect(spawnCount).toBe(1);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("rejects shutdown when the worker reports a durable cleanup failure", async () => {
    const child = new FakeChild();
    const supervisor = createCollabUtilitySupervisor({
      spawn: () => {
        queueMicrotask(() => child.emit("message", { type: "ready" }));
        return child;
      },
      createChannel: () => ({
        port1: { close: vi.fn() },
        port2: { close: vi.fn() },
      }),
      readyTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
    });
    await supervisor.attach(target(4));

    const closing = supervisor.close();
    const rejected = expect(closing).rejects.toMatchObject({ code: "store-cleanup-failed" });
    child.emit("message", { type: "closed", ok: false, code: "store-cleanup-failed" });

    await rejected;
    expect(child.kill).not.toHaveBeenCalled();
    expect(supervisor.close()).toBe(closing);
  });

  it("does not treat an unacknowledged zero-code worker exit as durable cleanup", async () => {
    const child = new FakeChild();
    const supervisor = createCollabUtilitySupervisor({
      spawn: () => {
        queueMicrotask(() => child.emit("message", { type: "ready" }));
        return child;
      },
      createChannel: () => ({
        port1: { close: vi.fn() },
        port2: { close: vi.fn() },
      }),
      readyTimeoutMs: 1_000,
      shutdownTimeoutMs: 1_000,
    });
    await supervisor.attach(target(6));

    const closing = supervisor.close();
    child.emit("exit", 0);

    await expect(closing).rejects.toMatchObject({
      code: "store-worker-shutdown-unacknowledged",
    });
    expect(supervisor.close()).toBe(closing);
  });

  it("kills a worker that misses its shutdown deadline and reports the timeout", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const supervisor = createCollabUtilitySupervisor({
        spawn: () => {
          queueMicrotask(() => child.emit("message", { type: "ready" }));
          return child;
        },
        createChannel: () => ({
          port1: { close: vi.fn() },
          port2: { close: vi.fn() },
        }),
        readyTimeoutMs: 1_000,
        shutdownTimeoutMs: 25,
      });
      const attached = supervisor.attach(target(5));
      await vi.runAllTicks();
      await attached;

      const closing = supervisor.close();
      const rejected = expect(closing).rejects.toMatchObject({ code: "store-worker-shutdown-timeout" });
      await vi.advanceTimersByTimeAsync(25);

      await rejected;
      expect(child.kill).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
