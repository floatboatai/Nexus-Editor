import { describe, expect, it } from "vitest";

import {
  PLUGIN_HOST_PERMISSIONS,
  PLUGIN_IPC_CHANNELS,
  PluginIpcSchemaError,
  parsePluginIpcEvent,
  parsePluginIpcRequest,
  parsePluginIpcResponse,
  type VaultSessionId,
} from "../src/shared/plugin-ipc";

const sessionId = "11111111-1111-4111-8111-111111111111" as VaultSessionId;

describe("plugin IPC schema", () => {
  it("keeps a closed, shared channel catalog", () => {
    expect(new Set(PLUGIN_IPC_CHANNELS).size).toBe(PLUGIN_IPC_CHANNELS.length);
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:write");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:projection-write-acquire");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:projection-opening-reserve");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:projection-opening-commit");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:projection-opening-list");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:delete-reserve");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:delete-list");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:commit");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:vault:revoke-resource-url");
    expect(PLUGIN_IPC_CHANNELS).toContain("nexus:storage:save");
    expect(PLUGIN_HOST_PERMISSIONS).toEqual({
      externalUrl: "host.external-url.https",
      externalProtocol: "host.external-protocol.mailto",
      systemShell: "host.system-shell",
    });
  });

  it("rejects malformed requests before host code executes", () => {
    expect(() => parsePluginIpcRequest("nexus:vault:read", {
      sessionId,
      path: 42,
    })).toThrowError(PluginIpcSchemaError);
    expect(() => parsePluginIpcRequest("nexus:storage:save", {
      pluginId: "fixture",
      expectedRevision: -1,
      data: {},
    })).toThrow(/expectedRevision/);
    expect(() => parsePluginIpcRequest("nexus:vault:pick", { unexpected: true })).toThrow(/empty object/);
    expect(() => parsePluginIpcRequest("nexus:vault:delete-reserve", {
      sessionId,
      path: "Notes",
      operationId: "delete-notes",
      state: "expired",
    })).toThrow(/state/);
    expect(() => parsePluginIpcRequest("nexus:vault:projection-opening-reserve", {
      sessionId,
      path: "Notes/A.md",
      documentId: "document-a",
      operationId: "join-a",
      recoveryOwner: { senderId: "7", sessionId },
    })).toThrow(/senderId/);
    expect(() => parsePluginIpcRequest("nexus:host:open-external", {
      instanceCapability: "opaque-instance-capability",
      url: "https://example.com",
      command: "open",
    })).toThrow(/unexpected field command/);
  });

  it("validates requests, responses, and events in both IPC directions", () => {
    expect(parsePluginIpcRequest("nexus:vault:write", {
      sessionId,
      path: "Notes/A.md",
      content: "hello",
      expectedVersion: "sha256:old",
    })).toMatchObject({ path: "Notes/A.md" });
    expect(parsePluginIpcRequest("nexus:vault:write", {
      sessionId,
      path: "Notes/New.md",
      content: "hello",
      expectedVersion: null,
    })).toMatchObject({ expectedVersion: null });
    expect(parsePluginIpcRequest("nexus:vault:projection-write-acquire", {
      sessionId,
      path: "Notes/New.md",
      projectionOpeningOperationId: "join-opening",
    })).toMatchObject({ path: "Notes/New.md" });
    expect(parsePluginIpcResponse("nexus:vault:projection-write-acquire", {
      permitId: "projection-permit-1",
      path: "Notes/New.md",
    })).toMatchObject({ permitId: "projection-permit-1" });
    expect(parsePluginIpcRequest("nexus:vault:delete-reserve", {
      sessionId,
      path: "Notes",
      operationId: "delete-notes",
      state: "precommit",
    })).toMatchObject({ operationId: "delete-notes", state: "precommit" });
    expect(parsePluginIpcRequest("nexus:vault:projection-opening-reserve", {
      sessionId,
      path: "Notes/New.md",
      documentId: "document-new",
      operationId: "join-opening",
    })).toMatchObject({ operationId: "join-opening" });
    const opening = {
      active: true,
      documentId: "document-new",
      operationId: "join-opening",
      owner: { senderId: 7, sessionId },
      path: "Notes/New.md",
      state: "precommit" as const,
      vaultId: "vault-a",
    };
    expect(parsePluginIpcResponse("nexus:vault:projection-opening-reserve", opening))
      .toEqual(opening);
    expect(parsePluginIpcRequest("nexus:vault:projection-opening-commit", {
      sessionId,
      path: "Notes/New.md",
      documentId: "document-new",
      operationId: "join-opening",
    })).toMatchObject({ documentId: "document-new" });
    expect(parsePluginIpcResponse("nexus:vault:projection-opening-list", [opening]))
      .toEqual([opening]);
    expect(parsePluginIpcResponse("nexus:vault:projection-opening-release", {
      released: false,
    })).toEqual({ released: false });
    expect(parsePluginIpcResponse("nexus:vault:delete-list", [{
      path: "Notes",
      operationId: "delete-notes",
      state: "precommit",
    }])).toHaveLength(1);
    expect(parsePluginIpcResponse("nexus:vault:delete-release", {
      released: true,
    })).toEqual({ released: true });

    expect(parsePluginIpcRequest("nexus:vault:revoke-resource-url", {
      sessionId,
      registrationId: "opaque-token",
    })).toMatchObject({ registrationId: "opaque-token" });

    expect(parsePluginIpcRequest("nexus:vault:commit", { sessionId }))
      .toEqual({ sessionId });

    expect(parsePluginIpcRequest("nexus:host:open-external", {
      instanceCapability: "opaque-instance-capability",
      url: "mailto:hello@example.com",
    })).toEqual({ instanceCapability: "opaque-instance-capability", url: "mailto:hello@example.com" });

    expect(parsePluginIpcRequest("nexus:host:activate-plugin", {
      pluginId: "fixture",
    })).toEqual({ pluginId: "fixture" });

    expect(() => parsePluginIpcRequest("nexus:host:activate-plugin", {
      pluginId: "fixture",
      declaredPermissions: [PLUGIN_HOST_PERMISSIONS.externalUrl],
      grantedPermissions: ["host.system-shell-or-command"],
    })).toThrow(/unexpected field/);

    expect(parsePluginIpcResponse("nexus:host:activate-plugin", {
      instanceCapability: "opaque-instance-capability",
    })).toEqual({ instanceCapability: "opaque-instance-capability" });

    expect(parsePluginIpcResponse("nexus:vault:restore", {
      sessionId,
      vaultId: "vault-stable-a",
      name: "Fixture",
    })).toMatchObject({ vaultId: "vault-stable-a" });
    expect(() => parsePluginIpcResponse("nexus:vault:restore", {
      sessionId,
      name: "Fixture",
    })).toThrow(/vaultId/);

    expect(parsePluginIpcResponse("nexus:vault:read", {
      path: "Notes/A.md",
      content: "hello",
      version: "sha256:new",
    })).toMatchObject({ version: "sha256:new" });

    expect(parsePluginIpcResponse("nexus:storage:load", {
      found: false,
      corrupt: true,
      revision: 0,
      data: null,
    })).toMatchObject({ found: false, corrupt: true });
    expect(() => parsePluginIpcResponse("nexus:storage:load", {
      found: true,
      corrupt: true,
      revision: 1,
      data: {},
    })).toThrow(/corrupt/);

    expect(parsePluginIpcEvent("nexus:vault:changed", {
      sessionId,
      kind: "modify",
      path: "Notes/A.md",
      version: "sha256:new",
      origin: "external",
    })).toMatchObject({ kind: "modify" });

    expect(() => parsePluginIpcResponse("nexus:vault:list", [{
      name: "A.md",
      path: "/private/vault/A.md",
      kind: "directory",
    }])).toThrow(/kind/);
    expect(() => parsePluginIpcEvent("nexus:host:shutdown", { reason: "crash" })).toThrow(/reason/);
  });
});
