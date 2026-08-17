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
    expect(() => parsePluginIpcRequest("nexus:host:open-external", {
      instanceCapability: "opaque-instance-capability",
      url: "https://example.com",
      command: "open",
    })).toThrow(/unexpected field command/);
  });

  it("keeps missing, available, and corrupt storage states distinct", () => {
    expect(parsePluginIpcResponse("nexus:storage:load", {
      status: "missing",
      revision: 0,
    })).toEqual({ status: "missing", revision: 0 });
    expect(parsePluginIpcResponse("nexus:storage:load", {
      status: "available",
      revision: 3,
      data: "serialized",
    })).toEqual({ status: "available", revision: 3, data: "serialized" });
    expect(parsePluginIpcResponse("nexus:storage:load", {
      status: "corrupt",
      revision: 0,
      raw: "{broken",
    })).toEqual({ status: "corrupt", revision: 0, raw: "{broken" });

    expect(() => parsePluginIpcResponse("nexus:storage:load", {
      found: false,
      revision: 0,
      data: null,
    })).toThrow(/storage status/);
    expect(() => parsePluginIpcResponse("nexus:storage:load", {
      status: "corrupt",
      revision: 1,
      raw: "{broken",
    })).toThrow(/revision/);
  });

  it("validates requests, responses, and events in both IPC directions", () => {
    expect(parsePluginIpcRequest("nexus:vault:write", {
      sessionId,
      path: "Notes/A.md",
      content: "hello",
      expectedVersion: "sha256:old",
    })).toMatchObject({ path: "Notes/A.md" });

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

    expect(parsePluginIpcResponse("nexus:vault:read", {
      path: "Notes/A.md",
      content: "hello",
      version: "sha256:new",
    })).toMatchObject({ version: "sha256:new" });

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
