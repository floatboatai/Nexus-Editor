import type { CollaborationStoreChannel } from "../src/shared/collab-store-protocol";

export interface MainLikeMessagePort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { readonly data: unknown }) => void): unknown;
  off(event: "message", listener: (event: { readonly data: unknown }) => void): unknown;
  on(event: "close", listener: () => void): unknown;
  off(event: "close", listener: () => void): unknown;
  start(): void;
  close(): void;
}

export interface RendererLikeMessagePort {
  postMessage(message: unknown): void;
  addEventListener(event: "message", listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(event: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(event: "close", listener: () => void): void;
  removeEventListener(event: "close", listener: () => void): void;
  start(): void;
  close(): void;
}

export function mainMessagePortChannel(port: MainLikeMessagePort): CollaborationStoreChannel {
  port.start();
  return {
    postMessage: (message) => port.postMessage(message),
    subscribe(listener) {
      const handle = (event: { readonly data: unknown }) => listener(event.data);
      port.on("message", handle);
      return () => port.off("message", handle);
    },
    subscribeClose(listener) {
      port.on("close", listener);
      return () => port.off("close", listener);
    },
    close: () => port.close(),
  };
}

export function rendererMessagePortChannel(port: RendererLikeMessagePort): CollaborationStoreChannel {
  port.start();
  return {
    postMessage: (message) => port.postMessage(message),
    subscribe(listener) {
      const handle = (event: { readonly data: unknown }) => listener(event.data);
      port.addEventListener("message", handle);
      return () => port.removeEventListener("message", handle);
    },
    subscribeClose(listener) {
      port.addEventListener("close", listener);
      return () => port.removeEventListener("close", listener);
    },
    close: () => port.close(),
  };
}
