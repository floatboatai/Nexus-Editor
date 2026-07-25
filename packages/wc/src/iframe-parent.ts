import {
  assertExactOrigin,
  createProtocolMessage,
  isProtocolMessage,
  type NexusIframeChangeEvent,
  type NexusIframeConnectMessage,
  type NexusIframePortMessage,
  type NexusIframeRequestMessage,
  type NexusIframeResponseMessage,
  type NexusIframeRuntimeReadyMessage,
} from "./iframe-protocol";

const DEFAULT_TIMEOUT_MS = 5_000;

export interface NexusIframeConnectOptions {
  targetOrigin: string;
  timeoutMs?: number;
}

export interface NexusIframeController {
  readonly ready: Promise<void>;
  getDocument(): Promise<string>;
  setDocument(value: string): Promise<void>;
  focus(): Promise<void>;
  onChange(listener: (doc: string) => void): () => void;
  destroy(): void;
}

export type NexusIframeBridgeErrorCode =
  | "COMPOSING"
  | "DESTROYED"
  | "IFRAME_RELOADED"
  | "MESSAGE_ERROR"
  | "REMOTE_ERROR"
  | "TIMEOUT"
  | "UNSUPPORTED_ENVIRONMENT";

function isBridgeErrorCode(value: unknown): value is NexusIframeBridgeErrorCode {
  return value === "COMPOSING" ||
    value === "DESTROYED" ||
    value === "IFRAME_RELOADED" ||
    value === "MESSAGE_ERROR" ||
    value === "REMOTE_ERROR" ||
    value === "TIMEOUT" ||
    value === "UNSUPPORTED_ENVIRONMENT";
}

export class NexusIframeBridgeError extends Error {
  constructor(
    readonly code: NexusIframeBridgeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "NexusIframeBridgeError";
  }
}

interface PendingRequest {
  resolve(value: string | undefined): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

function readTimeout(value: number | undefined): number {
  const timeout = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError("timeoutMs must be a positive finite number.");
  }
  return timeout;
}

export function connectNexusIframe(
  iframe: HTMLIFrameElement,
  options: NexusIframeConnectOptions,
): NexusIframeController {
  if (typeof window === "undefined" || typeof MessageChannel === "undefined") {
    throw new NexusIframeBridgeError("UNSUPPORTED_ENVIRONMENT", "The iframe bridge requires a browser MessageChannel.");
  }
  assertExactOrigin(options.targetOrigin, "targetOrigin");
  const timeoutMs = readTimeout(options.timeoutMs);

  let port: MessagePort | null = null;
  let runtimeId: string | null = null;
  let destroyed = false;
  let terminalError: Error | null = null;
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  let readySettled = false;
  let nextRequestId = 1;
  const pending = new Map<number, PendingRequest>();
  const changeListeners = new Set<(doc: string) => void>();

  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const connectionTimer = setTimeout(() => {
    fail(new NexusIframeBridgeError("TIMEOUT", "Timed out waiting for the iframe runtime."));
  }, timeoutMs);

  function removeListeners(): void {
    window.removeEventListener("message", onWindowMessage);
    iframe.removeEventListener("load", onIframeLoad);
  }

  function rejectPending(error: Error): void {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }

  function fail(error: Error): void {
    if (destroyed) return;
    destroyed = true;
    terminalError = error;
    clearTimeout(connectionTimer);
    if (reloadTimer) clearTimeout(reloadTimer);
    removeListeners();
    port?.close();
    port = null;
    rejectPending(error);
    // Every terminal path lands here, including timeout and reload — release
    // host closures rather than retaining them on a dead controller.
    changeListeners.clear();
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
  }

  function postProbe(): void {
    if (destroyed) return;
    iframe.contentWindow?.postMessage(
      createProtocolMessage({ type: "probe" as const }),
      options.targetOrigin,
    );
  }

  function onIframeLoad(): void {
    postProbe();
    if (!runtimeId || destroyed) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      fail(new NexusIframeBridgeError("IFRAME_RELOADED", "The iframe reloaded without a compatible runtime."));
    }, timeoutMs);
  }

  function onWindowMessage(event: MessageEvent<unknown>): void {
    if (destroyed || event.source !== iframe.contentWindow || event.origin !== options.targetOrigin) return;
    if (!isProtocolMessage(event.data) || event.data.type !== "runtime-ready") return;
    const message = event.data as unknown as NexusIframeRuntimeReadyMessage;
    if (typeof message.runtimeId !== "string" || message.runtimeId.length === 0) return;

    if (runtimeId && runtimeId !== message.runtimeId) {
      fail(new NexusIframeBridgeError("IFRAME_RELOADED", "The iframe runtime reloaded during the connection."));
      return;
    }
    if (runtimeId) {
      if (reloadTimer) {
        clearTimeout(reloadTimer);
        reloadTimer = null;
      }
      return;
    }

    runtimeId = message.runtimeId;
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = onPortMessage;
    port.onmessageerror = () => {
      fail(new NexusIframeBridgeError("MESSAGE_ERROR", "The iframe bridge received an unreadable message."));
    };
    port.start();

    const connectMessage: NexusIframeConnectMessage = createProtocolMessage({
      type: "connect",
      runtimeId,
    });
    iframe.contentWindow?.postMessage(connectMessage, options.targetOrigin, [channel.port2]);
  }

  function onPortMessage(event: MessageEvent<unknown>): void {
    if (destroyed || !isProtocolMessage(event.data)) return;
    const message = event.data as unknown as NexusIframePortMessage;
    if (message.type === "ready") {
      clearTimeout(connectionTimer);
      if (!readySettled) {
        readySettled = true;
        resolveReady();
      }
      return;
    }
    if (message.type === "change") {
      const change = message as NexusIframeChangeEvent;
      if (typeof change.doc !== "string") return;
      for (const listener of changeListeners) {
        try {
          listener(change.doc);
        } catch (error) {
          queueMicrotask(() => { throw error; });
        }
      }
      return;
    }
    if (message.type !== "response") return;

    const response = message as NexusIframeResponseMessage;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.ok) {
      request.resolve(response.result);
    } else {
      const code = isBridgeErrorCode(response.error?.code) ? response.error.code : "REMOTE_ERROR";
      request.reject(new NexusIframeBridgeError(
        code,
        response.error?.message ?? "The iframe runtime rejected the request.",
      ));
    }
  }

  async function request(method: NexusIframeRequestMessage["method"], value?: string): Promise<string | undefined> {
    await ready;
    if (destroyed || !port) {
      throw terminalError ?? new NexusIframeBridgeError("DESTROYED", "The iframe bridge has been destroyed.");
    }
    const id = nextRequestId++;
    return new Promise<string | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new NexusIframeBridgeError("TIMEOUT", `Timed out waiting for ${method}.`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      port!.postMessage(createProtocolMessage({
        type: "request" as const,
        id,
        method,
        ...(value === undefined ? {} : { value }),
      }));
    });
  }

  window.addEventListener("message", onWindowMessage);
  iframe.addEventListener("load", onIframeLoad);
  queueMicrotask(postProbe);

  return {
    ready,
    async getDocument() {
      return (await request("getDocument")) ?? "";
    },
    async setDocument(value: string) {
      if (typeof value !== "string") throw new TypeError("setDocument value must be a string.");
      await request("setDocument", value);
    },
    async focus() {
      await request("focus");
    },
    onChange(listener) {
      if (typeof listener !== "function") throw new TypeError("onChange listener must be a function.");
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      port?.postMessage(createProtocolMessage({ type: "destroy" as const }));
      fail(new NexusIframeBridgeError("DESTROYED", "The iframe bridge has been destroyed."));
    },
  };
}
