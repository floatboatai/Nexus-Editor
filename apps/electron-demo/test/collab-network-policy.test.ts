import { describe, expect, it } from "vitest";

import {
  collaborationContentSecurityPolicy,
  parseCollaborationNetworkConfiguration,
} from "../src/shared/collab-network-policy";

describe("trusted collaboration network configuration", () => {
  it("uses one exact endpoint list for configuration and renderer connection policy", () => {
    const configuration = parseCollaborationNetworkConfiguration(
      "ws://127.0.0.1:1234, wss://COLLAB.example.test:443/socket",
    );

    expect(configuration.serverUrls).toEqual([
      "ws://127.0.0.1:1234",
      "wss://collab.example.test/socket",
    ]);
    expect(collaborationContentSecurityPolicy(configuration)).toContain(
      "connect-src 'self' ws://127.0.0.1:1234 wss://collab.example.test;",
    );
    expect(parseCollaborationNetworkConfiguration(undefined).serverUrls)
      .toEqual(["ws://127.0.0.1:1234"]);
  });

  it.each([
    "", "ws://collab.example.test", "https://collab.example.test", "wss://user:secret@collab.example.test",
    "wss://collab.example.test?token=secret", "wss://collab.example.test#fragment", "wss://*.example.test",
    "wss://collab.example.test/%2a", "wss://collab.example.test/socket;script-src", "wss://collab.example.test/a'b",
    "wss://collab.example.test/a%0ab", "wss://collab.example.test,", Array(17).fill("wss://collab.example.test").join(","),
  ])("rejects unsafe or unbounded configuration: %s", (value) => {
    expect(() => parseCollaborationNetworkConfiguration(value)).toThrow();
  });

  it("permits dev HMR only on the validated loopback origin", () => {
    const configuration = parseCollaborationNetworkConfiguration(undefined);
    expect(collaborationContentSecurityPolicy(configuration, "http://localhost:5173/")).toContain("ws://localhost:5173;");
    expect(() => collaborationContentSecurityPolicy(configuration, "http://example.test:5173/")).toThrow();
    expect(() => collaborationContentSecurityPolicy(configuration, "http://localhost:5173/?x=1")).toThrow();
  });
});
