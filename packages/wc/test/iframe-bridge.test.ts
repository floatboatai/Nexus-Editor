import { afterEach, describe, expect, it, vi } from "vitest";

import { connectNexusIframe, NexusIframeBridgeError } from "../src/iframe-parent";
import {
  createProtocolMessage,
  type NexusIframePortMessage,
  type NexusIframeRequestMessage,
  type NexusIframeResponseMessage,
} from "../src/iframe-protocol";
import { mountNexusIframeRuntime } from "../src/iframe-runtime";

const ORIGIN = "https://embed.example";

class FakeMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  peer: FakeMessagePort | null = null;
  closed = false;

  postMessage(message: unknown): void {
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer && !peer.closed) peer.onmessage?.(new MessageEvent("message", { data: message }));
    });
  }

  start(): void {}

  close(): void {
    this.closed = true;
  }
}

class FakeMessageChannel {
  readonly port1: MessagePort;
  readonly port2: MessagePort;

  constructor() {
    const first = new FakeMessagePort();
    const second = new FakeMessagePort();
    first.peer = second;
    second.peer = first;
    this.port1 = first as unknown as MessagePort;
    this.port2 = second as unknown as MessagePort;
  }
}

function installFakeMessageChannel(): void {
  vi.stubGlobal("MessageChannel", FakeMessageChannel);
}

function announceRuntime(source: Window, runtimeId: string, origin = ORIGIN): void {
  window.dispatchEvent(new MessageEvent("message", {
    data: createProtocolMessage({ type: "runtime-ready" as const, runtimeId }),
    origin,
    source,
  }));
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("connectNexusIframe", () => {
  it("connects, proxies document commands, forwards changes, and destroys the runtime", async () => {
    installFakeMessageChannel();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const childWindow = iframe.contentWindow!;
    let runtimePort: MessagePort | null = null;
    let documentValue = "seed";
    let focusCount = 0;
    let runtimeDestroyed = false;

    vi.spyOn(childWindow, "postMessage").mockImplementation(((
      message: unknown,
      _targetOrigin: string | WindowPostMessageOptions,
      transfer?: Transferable[],
    ) => {
      if ((message as { type?: string }).type === "probe") {
        queueMicrotask(() => announceRuntime(childWindow, "runtime-1"));
        return;
      }
      if ((message as { type?: string }).type !== "connect") return;
      runtimePort = transfer?.[0] as MessagePort;
      runtimePort.onmessage = (event: MessageEvent<unknown>) => {
        const request = event.data as NexusIframePortMessage;
        if (request.type === "destroy") {
          runtimeDestroyed = true;
          return;
        }
        if (request.type !== "request") return;
        let result: string | undefined;
        if (request.method === "getDocument") result = documentValue;
        if (request.method === "setDocument") documentValue = request.value!;
        if (request.method === "focus") focusCount += 1;
        runtimePort!.postMessage(createProtocolMessage({
          type: "response" as const,
          id: request.id,
          ok: true,
          ...(result === undefined ? {} : { result }),
        }));
      };
      runtimePort.start();
      runtimePort.postMessage(createProtocolMessage({ type: "ready" as const }));
    }) as typeof childWindow.postMessage);

    const controller = connectNexusIframe(iframe, { targetOrigin: ORIGIN, timeoutMs: 500 });
    await controller.ready;
    expect(await controller.getDocument()).toBe("seed");

    await controller.setDocument("next");
    await controller.focus();
    expect(documentValue).toBe("next");
    expect(focusCount).toBe(1);

    const onChange = vi.fn();
    const unsubscribe = controller.onChange(onChange);
    runtimePort!.postMessage(createProtocolMessage({ type: "change" as const, doc: "user edit" }));
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledWith("user edit");
    unsubscribe();

    controller.destroy();
    await Promise.resolve();
    expect(runtimeDestroyed).toBe(true);
    await expect(controller.getDocument()).rejects.toMatchObject({ code: "DESTROYED" });
  });

  it("requires an exact target origin", () => {
    installFakeMessageChannel();
    const iframe = document.createElement("iframe");

    expect(() => connectNexusIframe(iframe, { targetOrigin: "*" })).toThrow(/origin/i);
    expect(() => connectNexusIframe(iframe, { targetOrigin: "https://embed.example/path" })).toThrow(/origin/i);
  });

  it("rejects the controller when a different runtime appears after reload", async () => {
    installFakeMessageChannel();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const childWindow = iframe.contentWindow!;

    vi.spyOn(childWindow, "postMessage").mockImplementation(((_message: unknown) => {}) as typeof childWindow.postMessage);
    const controller = connectNexusIframe(iframe, { targetOrigin: ORIGIN, timeoutMs: 500 });
    announceRuntime(childWindow, "runtime-1");
    announceRuntime(childWindow, "runtime-2");

    await expect(controller.ready).rejects.toMatchObject({
      code: "IFRAME_RELOADED",
    } satisfies Partial<NexusIframeBridgeError>);
  });

  it("invalidates a connected controller when a reload starts no runtime", async () => {
    installFakeMessageChannel();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const childWindow = iframe.contentWindow!;
    let runtimePort: MessagePort | null = null;
    let answerProbe = true;

    vi.spyOn(childWindow, "postMessage").mockImplementation(((
      message: unknown,
      _targetOrigin: string | WindowPostMessageOptions,
      transfer?: Transferable[],
    ) => {
      if ((message as { type?: string }).type === "probe" && answerProbe) {
        queueMicrotask(() => announceRuntime(childWindow, "runtime-1"));
      }
      if ((message as { type?: string }).type === "connect") {
        runtimePort = transfer?.[0] as MessagePort;
        runtimePort.start();
        runtimePort.postMessage(createProtocolMessage({ type: "ready" as const }));
      }
    }) as typeof childWindow.postMessage);

    const controller = connectNexusIframe(iframe, { targetOrigin: ORIGIN, timeoutMs: 20 });
    await controller.ready;
    answerProbe = false;
    iframe.dispatchEvent(new Event("load"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    await expect(controller.getDocument()).rejects.toMatchObject({ code: "IFRAME_RELOADED" });
  });
});

describe("mountNexusIframeRuntime", () => {
  it("validates the parent origin before mounting", () => {
    expect(() => mountNexusIframeRuntime({
      container: document.createElement("div"),
      allowedParentOrigin: "*",
    })).toThrow();
  });

  it("serves commands only after an origin-checked connection", async () => {
    installFakeMessageChannel();
    const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent")!;
    const parentWindow = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(window, "parent", { configurable: true, value: parentWindow });

    try {
      const container = document.createElement("div");
      document.body.append(container);
      const configuredOnChange = vi.fn();
      const editor = mountNexusIframeRuntime({
        container,
        allowedParentOrigin: ORIGIN,
        editorConfig: { initialValue: "seed", parseDelayMs: 0, onChange: configuredOnChange },
      });
      const runtimeReady = vi.mocked(parentWindow.postMessage).mock.calls[0]?.[0] as { runtimeId: string };
      const channel = new FakeMessageChannel();
      const parentPort = channel.port1;
      const runtimePort = channel.port2;
      const received: unknown[] = [];
      parentPort.onmessage = (event) => received.push(event.data);
      parentPort.start();

      window.dispatchEvent(new MessageEvent("message", {
        data: createProtocolMessage({ type: "connect" as const, runtimeId: runtimeReady.runtimeId }),
        origin: "https://wrong.example",
        source: parentWindow,
        ports: [runtimePort],
      }));
      await Promise.resolve();
      expect(received).toEqual([]);

      window.dispatchEvent(new MessageEvent("message", {
        data: createProtocolMessage({ type: "connect" as const, runtimeId: runtimeReady.runtimeId }),
        origin: ORIGIN,
        source: parentWindow,
        ports: [runtimePort],
      }));
      await Promise.resolve();
      expect(received).toContainEqual(expect.objectContaining({ type: "ready" }));

      async function request(message: Omit<NexusIframeRequestMessage, "protocol" | "version">) {
        parentPort.postMessage(createProtocolMessage(message));
        await Promise.resolve();
        await Promise.resolve();
        return received.find((item) =>
          (item as NexusIframeResponseMessage).type === "response" &&
          (item as NexusIframeResponseMessage).id === message.id
        ) as NexusIframeResponseMessage;
      }

      expect(await request({ type: "request", id: 1, method: "getDocument" }))
        .toMatchObject({ ok: true, result: "seed" });
      expect(await request({ type: "request", id: 2, method: "setDocument", value: "external" }))
        .toMatchObject({ ok: true });
      expect(editor.getDocument()).toBe("external");
      expect(configuredOnChange).not.toHaveBeenCalled();

      vi.spyOn(editor, "isComposing").mockReturnValue(true);
      expect(await request({ type: "request", id: 3, method: "setDocument", value: "during IME" }))
        .toMatchObject({ ok: false, error: { code: "COMPOSING" } });
      expect(editor.getDocument()).toBe("external");

      editor.setDocument("user edit");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(configuredOnChange).toHaveBeenCalled();
      expect(received).toContainEqual(expect.objectContaining({ type: "change", doc: "user edit" }));

      parentPort.postMessage(createProtocolMessage({ type: "destroy" as const }));
      await Promise.resolve();
      expect(container.querySelector(".cm-editor")).toBeNull();
    } finally {
      Object.defineProperty(window, "parent", parentDescriptor);
    }
  });
});
