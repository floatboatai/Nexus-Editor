export interface CollabUtilityPort {
  close(): void;
  readonly id?: string;
}

export interface CollabUtilityChannelPair {
  readonly port1: CollabUtilityPort;
  readonly port2: CollabUtilityPort;
}

export interface CollabUtilityChild {
  on(event: "spawn" | "message" | "exit", listener: (...args: never[]) => void): this;
  off(event: "spawn" | "message" | "exit", listener: (...args: never[]) => void): this;
  postMessage(message: unknown, ports?: readonly CollabUtilityPort[]): void;
  kill(): boolean;
}

export interface CollabUtilityRendererTarget {
  readonly id: number;
  isDestroyed(): boolean;
  postMessage(channel: string, message: unknown, ports?: readonly CollabUtilityPort[]): void;
}

export interface CollabUtilitySupervisorOptions {
  readonly spawn: () => CollabUtilityChild;
  readonly createChannel: () => CollabUtilityChannelPair;
  readonly readyTimeoutMs?: number;
  readonly shutdownTimeoutMs?: number;
  readonly restartDelayMs?: number;
}

export interface CollabUtilitySupervisor {
  attach(target: CollabUtilityRendererTarget): Promise<void>;
  detach(rendererId: number): void;
  close(): Promise<void>;
  inspect(): {
    readonly state: "idle" | "starting" | "ready" | "restarting" | "closed";
    readonly generation: number;
    readonly renderers: number;
  };
}

const PORT_CHANNEL = "nexus:collab-store:port";

function assertTimeout(value: number, label: string, allowZero = false): void {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${label} must be ${allowZero ? "a non-negative" : "a positive"} safe integer`);
  }
}

function isReadyMessage(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { readonly type?: unknown }).type === "ready" &&
    Object.keys(value as object).length === 1,
  );
}

type WorkerClosedMessage =
  | { readonly type: "closed"; readonly ok: true }
  | { readonly type: "closed"; readonly ok: false; readonly code: string };

function parseWorkerClosedMessage(value: unknown): WorkerClosedMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as { readonly type?: unknown; readonly ok?: unknown; readonly code?: unknown };
  if (candidate.type !== "closed") return null;
  const keys = Object.keys(value).sort();
  if (candidate.ok === true && keys.length === 2 && keys[0] === "ok" && keys[1] === "type") {
    return { type: "closed", ok: true };
  }
  if (
    candidate.ok === false
    && keys.length === 3
    && keys[0] === "code"
    && keys[1] === "ok"
    && keys[2] === "type"
    && typeof candidate.code === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(candidate.code)
  ) {
    return { type: "closed", ok: false, code: candidate.code };
  }
  return null;
}

function supervisorFailure(code: string, message: string, cause?: unknown): Error & { readonly code: string } {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { code });
}

export function createCollabUtilitySupervisor(
  options: CollabUtilitySupervisorOptions,
): CollabUtilitySupervisor {
  const readyTimeoutMs = options.readyTimeoutMs ?? 5_000;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? 2_000;
  const restartDelayMs = options.restartDelayMs ?? 100;
  assertTimeout(readyTimeoutMs, "readyTimeoutMs");
  assertTimeout(shutdownTimeoutMs, "shutdownTimeoutMs");
  assertTimeout(restartDelayMs, "restartDelayMs", true);

  const targets = new Map<number, CollabUtilityRendererTarget>();
  const targetGeneration = new Map<number, number>();
  let state: ReturnType<CollabUtilitySupervisor["inspect"]>["state"] = "idle";
  let child: CollabUtilityChild | null = null;
  let generation = 0;
  let readyPromise: Promise<CollabUtilityChild> | null = null;
  let resolveReady: ((child: CollabUtilityChild) => void) | null = null;
  let rejectReady: ((cause: unknown) => void) | null = null;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  function clearReadyTimer(): void {
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = null;
  }

  function connectTarget(target: CollabUtilityRendererTarget, worker: CollabUtilityChild): void {
    if (closed || target.isDestroyed() || targets.get(target.id) !== target) return;
    if (targetGeneration.get(target.id) === generation) return;
    const channel = options.createChannel();
    try {
      worker.postMessage(
        { type: "connect", rendererId: target.id, generation },
        [channel.port2],
      );
      target.postMessage(PORT_CHANNEL, { generation }, [channel.port1]);
      targetGeneration.set(target.id, generation);
    } catch (cause) {
      try { channel.port1.close(); } catch { /* already transferred */ }
      try { channel.port2.close(); } catch { /* already transferred */ }
      throw cause;
    }
  }

  function connectAll(worker: CollabUtilityChild): void {
    for (const target of targets.values()) {
      try {
        connectTarget(target, worker);
      } catch {
        // A renderer may disappear between the registry check and transfer.
        // Other windows still receive their independent channel.
      }
    }
  }

  function scheduleRestart(): void {
    if (closed || targets.size === 0 || restartTimer) return;
    state = "restarting";
    restartTimer = setTimeout(() => {
      restartTimer = null;
      void ensureReady().catch(() => scheduleRestart());
    }, restartDelayMs);
  }

  function ensureReady(): Promise<CollabUtilityChild> {
    if (closed) return Promise.reject(new Error("Collaboration utility supervisor is closed"));
    if (child && state === "ready") return Promise.resolve(child);
    if (readyPromise) return readyPromise;

    state = state === "restarting" ? "restarting" : "starting";
    const worker = options.spawn();
    child = worker;
    readyPromise = new Promise<CollabUtilityChild>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // Restarts can fail after every caller has gone away. Keep the internal
    // promise observed while still returning the rejection to active callers.
    void readyPromise.catch(() => undefined);

    const onSpawn = () => undefined;
    const onMessage = (message: unknown) => {
      if (worker !== child) return;
      if (isReadyMessage(message)) {
        clearReadyTimer();
        generation += 1;
        state = "ready";
        const resolve = resolveReady;
        resolveReady = null;
        rejectReady = null;
        readyPromise = null;
        resolve?.(worker);
        connectAll(worker);
      }
    };
    const onExit = (code: unknown) => {
      worker.off("spawn", onSpawn as (...args: never[]) => void);
      worker.off("message", onMessage as (...args: never[]) => void);
      worker.off("exit", onExit as (...args: never[]) => void);
      if (worker !== child) return;
      clearReadyTimer();
      child = null;
      targetGeneration.clear();
      const reject = rejectReady;
      resolveReady = null;
      rejectReady = null;
      readyPromise = null;
      reject?.(Object.assign(new Error("Collaboration persistence process exited"), {
        code: "store-worker-exited",
        exitCode: code,
      }));
      if (!closed) scheduleRestart();
    };

    worker.on("spawn", onSpawn as (...args: never[]) => void);
    worker.on("message", onMessage as (...args: never[]) => void);
    worker.on("exit", onExit as (...args: never[]) => void);
    readyTimer = setTimeout(() => {
      if (worker !== child || state === "ready") return;
      const reject = rejectReady;
      resolveReady = null;
      rejectReady = null;
      readyPromise = null;
      child = null;
      reject?.(Object.assign(new Error("Collaboration persistence process did not become ready"), {
        code: "store-worker-ready-timeout",
      }));
      worker.kill();
      scheduleRestart();
    }, readyTimeoutMs);
    return readyPromise;
  }

  return {
    async attach(target): Promise<void> {
      if (closed) throw new Error("Collaboration utility supervisor is closed");
      if (!Number.isSafeInteger(target.id) || target.id <= 0) {
        throw new RangeError("Renderer id must be a positive safe integer");
      }
      targets.set(target.id, target);
      // A navigation keeps the WebContents id but replaces its preload world.
      // Force a fresh port for every explicit attach.
      targetGeneration.delete(target.id);
      const worker = await ensureReady();
      connectTarget(target, worker);
    },

    detach(rendererId): void {
      targets.delete(rendererId);
      targetGeneration.delete(rendererId);
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      state = "closed";
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      clearReadyTimer();
      targets.clear();
      targetGeneration.clear();
      const worker = child;
      child = null;
      rejectReady?.(Object.assign(new Error("Collaboration utility supervisor is closed"), {
        code: "store-worker-closed",
      }));
      resolveReady = null;
      rejectReady = null;
      readyPromise = null;
      if (!worker) {
        closePromise = Promise.resolve();
        return closePromise;
      }

      closePromise = new Promise<void>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const finish = (failure?: unknown) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          worker.off("message", onMessage as (...args: never[]) => void);
          worker.off("exit", onExit as (...args: never[]) => void);
          if (failure === undefined) resolve();
          else reject(failure);
        };
        const onMessage = (message: unknown) => {
          const closedMessage = parseWorkerClosedMessage(message);
          if (!closedMessage) return;
          if (closedMessage.ok) finish();
          else finish(supervisorFailure(
            closedMessage.code,
            "Collaboration persistence worker cleanup failed",
          ));
        };
        const onExit = (code: unknown) => {
          finish(supervisorFailure(
            code === 0
              ? "store-worker-shutdown-unacknowledged"
              : "store-worker-shutdown-failed",
            code === 0
              ? "Collaboration persistence worker exited without acknowledging durable cleanup"
              : "Collaboration persistence worker exited before a clean shutdown",
          ));
        };
        timer = setTimeout(() => {
          worker.kill();
          finish(supervisorFailure(
            "store-worker-shutdown-timeout",
            "Collaboration persistence worker missed its shutdown deadline",
          ));
        }, shutdownTimeoutMs);
        worker.on("message", onMessage as (...args: never[]) => void);
        worker.on("exit", onExit as (...args: never[]) => void);
        try {
          worker.postMessage({ type: "shutdown" });
        } catch (cause) {
          worker.kill();
          finish(supervisorFailure(
            "store-worker-shutdown-send-failed",
            "Could not request collaboration persistence worker shutdown",
            cause,
          ));
        }
      });
      return closePromise;
    },

    inspect: () => ({ state, generation, renderers: targets.size }),
  };
}
