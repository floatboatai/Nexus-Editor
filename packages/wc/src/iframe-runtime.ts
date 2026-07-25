import { createEditor } from "@floatboat/nexus-core";
import type { EditorAPI, EditorConfig } from "@floatboat/nexus-core";

import {
  assertExactOrigin,
  createProtocolMessage,
  isProtocolMessage,
  type NexusIframeConnectMessage,
  type NexusIframeRequestMessage,
  type NexusIframeResponseMessage,
} from "./iframe-protocol";

export interface NexusIframeRuntimeOptions {
  container: HTMLElement;
  editorConfig?: Omit<EditorConfig, "container">;
  allowedParentOrigin: string;
}

function createRuntimeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function mountNexusIframeRuntime(options: NexusIframeRuntimeOptions): EditorAPI {
  if (typeof window === "undefined") {
    throw new Error("The iframe runtime requires a browser window.");
  }
  if (window.parent === window) {
    throw new Error("The iframe runtime must be mounted inside an iframe.");
  }
  assertExactOrigin(options.allowedParentOrigin, "allowedParentOrigin");

  const runtimeId = createRuntimeId();
  let activePort: MessagePort | null = null;
  let destroyed = false;
  const configuredOnChange = options.editorConfig?.onChange;

  const editor = createEditor({
    ...options.editorConfig,
    container: options.container,
    onChange(doc, ast) {
      try {
        configuredOnChange?.(doc, ast);
      } finally {
        activePort?.postMessage(createProtocolMessage({ type: "change" as const, doc }));
      }
    },
  });
  const destroyEditor = editor.destroy.bind(editor);

  function postRuntimeReady(): void {
    if (destroyed) return;
    window.parent.postMessage(
      createProtocolMessage({ type: "runtime-ready" as const, runtimeId }),
      options.allowedParentOrigin,
    );
  }

  function sendResponse(response: Omit<NexusIframeResponseMessage, "protocol" | "version">): void {
    activePort?.postMessage(createProtocolMessage(response));
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("message", onWindowMessage);
    activePort?.close();
    activePort = null;
    destroyEditor();
  }

  function onPortMessage(event: MessageEvent<unknown>): void {
    if (destroyed || !isProtocolMessage(event.data)) return;
    if (event.data.type === "destroy") {
      destroy();
      return;
    }
    if (event.data.type !== "request") return;

    const request = event.data as unknown as NexusIframeRequestMessage;
    if (!Number.isSafeInteger(request.id) || request.id < 1) return;
    try {
      switch (request.method) {
        case "getDocument":
          sendResponse({ type: "response", id: request.id, ok: true, result: editor.getDocument() });
          break;
        case "setDocument":
          if (typeof request.value !== "string") {
            throw new TypeError("setDocument requires a string value.");
          }
          if (editor.isComposing()) {
            sendResponse({
              type: "response",
              id: request.id,
              ok: false,
              error: {
                code: "COMPOSING",
                message: "The iframe editor is composing text; retry setDocument after composition ends.",
              },
            });
            break;
          }
          editor.setDocument(request.value, { silent: true });
          sendResponse({ type: "response", id: request.id, ok: true });
          break;
        case "focus":
          editor.focus();
          sendResponse({ type: "response", id: request.id, ok: true });
          break;
        default:
          sendResponse({
            type: "response",
            id: request.id,
            ok: false,
            error: { code: "UNKNOWN_METHOD", message: "Unknown iframe bridge method." },
          });
      }
    } catch (error) {
      sendResponse({
        type: "response",
        id: request.id,
        ok: false,
        error: {
          code: "REMOTE_ERROR",
          message: error instanceof Error ? error.message : "The iframe runtime request failed.",
        },
      });
    }
  }

  function onWindowMessage(event: MessageEvent<unknown>): void {
    if (destroyed || event.source !== window.parent || event.origin !== options.allowedParentOrigin) return;
    if (!isProtocolMessage(event.data)) return;
    if (event.data.type === "probe") {
      postRuntimeReady();
      return;
    }
    if (event.data.type !== "connect" || activePort) return;

    const message = event.data as unknown as NexusIframeConnectMessage;
    const transferredPort = event.ports[0];
    if (message.runtimeId !== runtimeId || !transferredPort) return;
    activePort = transferredPort;
    activePort.onmessage = onPortMessage;
    activePort.start();
    activePort.postMessage(createProtocolMessage({ type: "ready" as const }));
  }

  // Wrap `destroy` so a consumer-initiated teardown also tears down the bridge.
  // The descriptor mirrors the plain data property `createEditor` returns —
  // without `writable`/`enumerable` the override would become read-only and
  // vanish from spreads such as `{ ...editor }`.
  Object.defineProperty(editor, "destroy", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: destroy,
  });
  window.addEventListener("message", onWindowMessage);
  postRuntimeReady();
  return editor;
}
