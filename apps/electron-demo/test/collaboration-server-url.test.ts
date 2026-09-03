import { describe, expect, it } from "vitest";

import { canonicalCollaborationServerUrl } from "../src/renderer/collaboration-server-url";

describe("Collaboration server URL policy", () => {
  it.each([
    "ws://localhost:1234/collaboration",
    "ws://127.0.0.1:1234/collaboration",
    "ws://[::1]:1234/collaboration",
    "wss://collab.example.test/collaboration",
    "wss://192.0.2.10:4443/collaboration",
  ])("accepts an authorized WebSocket endpoint: %s", (value) => {
    expect(canonicalCollaborationServerUrl(value)).toBe(value);
  });

  it.each([
    "ws://collab.example.test/collaboration",
    "ws://192.168.1.20:1234/collaboration",
    "ws://[::2]:1234/collaboration",
    "ws://localhost.example.test/collaboration",
    "wss://user:secret@collab.example.test/collaboration",
    "wss://collab.example.test/collaboration?token=secret",
    "wss://collab.example.test/collaboration?",
    "wss://collab.example.test/collaboration#secret",
    "wss://collab.example.test/collaboration#",
  ])("rejects an unsafe WebSocket endpoint: %s", (value) => {
    expect(() => canonicalCollaborationServerUrl(value)).toThrow(TypeError);
  });
});
