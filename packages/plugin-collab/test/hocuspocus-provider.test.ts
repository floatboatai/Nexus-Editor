import * as Y from "yjs";
import { describe, expect, it, vi } from "vitest";

import { createHocuspocusProviderFactory } from "../src/hocuspocus-provider";
import { asDocumentId, type CollaborationReplicaPort } from "../src/types";

function replica(): CollaborationReplicaPort {
  return {
    encodeStateVector: () => new Uint8Array(),
    encodeStateAsUpdate: () => new Uint8Array(),
    applyUpdate: () => undefined,
    onUpdate: () => () => undefined,
    encodeAwarenessUpdate: () => new Uint8Array(),
    applyAwarenessUpdate: () => undefined,
    onAwarenessUpdate: () => () => undefined,
    getAwarenessClientIds: () => [],
  };
}

describe("Hocuspocus Provider lifecycle", () => {
  it("does not retain an unbounded queue of document updates while the socket is offline", async () => {
    let onReplicaUpdate: ((update: Uint8Array, origin: unknown) => void) | undefined;
    const documentId = asDocumentId("provider-offline-outbound-bound");
    class OfflineWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = OfflineWebSocket.CONNECTING;
      binaryType = "arraybuffer";
      identifier = 0;
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
      send(): void {
        throw new Error("An offline WebSocket must not receive a frame");
      }
    }
    const factory = createHocuspocusProviderFactory({
      url: "ws://127.0.0.1:12345",
      token: () => "unused",
      initialSyncTimeoutMs: 100,
      webSocketPolyfill: OfflineWebSocket,
    });
    const lease = await factory.prepare({
      document: { id: documentId },
      replica: {
        ...replica(),
        encodeStateAsUpdate: () => Y.encodeStateAsUpdate(new Y.Doc()),
        onUpdate(listener) {
          onReplicaUpdate = listener;
          return () => { onReplicaUpdate = undefined; };
        },
      },
    });
    const starting = lease.start();
    void starting.catch(() => undefined);

    const source = new Y.Doc();
    for (let index = 0; index < 1_000; index += 1) {
      const before = Y.encodeStateVector(source);
      source.getText("content").insert(index, "x");
      onReplicaUpdate?.(Y.encodeStateAsUpdate(source, before), undefined);
    }

    const socket = Reflect.get(lease, "socket") as object;
    expect((Reflect.get(socket, "messageQueue") as unknown[]).length).toBe(0);
    Reflect.set(socket, "status", "connected");
    const transport = Reflect.get(socket, "webSocket") as OfflineWebSocket;
    transport.readyState = OfflineWebSocket.CLOSING;
    const beforeClosingUpdate = Y.encodeStateVector(source);
    source.getText("content").insert(source.getText("content").length, "x");
    onReplicaUpdate?.(Y.encodeStateAsUpdate(source, beforeClosingUpdate), undefined);
    expect((Reflect.get(socket, "messageQueue") as unknown[]).length).toBe(0);
    await expect(lease.release()).resolves.toBeUndefined();
    await expect(starting).rejects.toThrow("released");
  });

  it("publishes a retryable failed state when an explicit reconnect cannot start", async () => {
    const documentId = asDocumentId("provider-reconnect-failure-state");
    class OfflineWebSocket {
      static readonly CONNECTING = 0;
      readonly readyState = OfflineWebSocket.CONNECTING;
      binaryType = "arraybuffer";
      identifier = 0;
      addEventListener(): void {}
      removeEventListener(): void {}
      close(): void {}
      send(): void {}
    }
    const factory = createHocuspocusProviderFactory({
      url: "ws://127.0.0.1:12345",
      token: () => "unused",
      initialSyncTimeoutMs: 100,
      webSocketPolyfill: OfflineWebSocket,
    });
    const lease = await factory.prepare({ document: { id: documentId }, replica: replica() });
    const starting = lease.start();
    void starting.catch(() => undefined);
    const socket = Reflect.get(lease, "socket") as {
      status: string;
      connect: () => Promise<void>;
    };
    socket.status = "disconnected";
    const reconnectFailure = new Error("transport unavailable");
    vi.spyOn(socket, "connect").mockRejectedValueOnce(reconnectFailure);

    await expect(factory.control.reconnect(documentId)).rejects.toBe(reconnectFailure);
    expect(lease.getState()).toMatchObject({
      transport: "failed",
      sync: "failed",
      access: "none",
      diagnostic: { code: "provider-connect-failed" },
    });

    await expect(lease.release()).resolves.toBeUndefined();
    await expect(starting).rejects.toThrow("released");
  });

  it("releases its registry entry and remaining Yjs resources after one destroy fails", async () => {
    const documentId = asDocumentId("provider-release-cleanup");
    const factory = createHocuspocusProviderFactory({
      url: "ws://127.0.0.1:12345",
      token: () => "unused",
    });
    const lease = await factory.prepare({ document: { id: documentId }, replica: replica() });
    const destroyFailure = new Error("Y.Doc destroy failed");
    const originalDestroy = Y.Doc.prototype.destroy;
    let destroyCalls = 0;
    const destroy = vi.spyOn(Y.Doc.prototype, "destroy").mockImplementation(function (this: Y.Doc) {
      destroyCalls += 1;
      originalDestroy.call(this);
      if (destroyCalls === 1) throw destroyFailure;
    });

    const result = await Promise.allSettled([lease.release()]);
    destroy.mockRestore();

    expect(result[0]?.status).toBe("rejected");
    expect(destroyCalls).toBe(2);
    await expect(factory.control.reconnect(documentId)).rejects.toThrow(
      `No active collaboration Provider for ${documentId}`,
    );
    await expect(lease.release()).resolves.toBeUndefined();
  });
});
