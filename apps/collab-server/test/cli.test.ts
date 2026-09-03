import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseInvitationAllowedOrigins, parseIssuedTokenLifetime } from "../src/cli";
import { createCollaborationServer } from "../src/server";

describe("collaboration server CLI invitation Origin configuration", () => {
  it("distinguishes an unset default, an explicit deny-all, and a comma-separated allowlist", () => {
    expect(parseInvitationAllowedOrigins(undefined)).toBeUndefined();
    expect(parseInvitationAllowedOrigins("")).toEqual([]);
    expect(parseInvitationAllowedOrigins("null, https://editor.example.test")).toEqual([
      "null",
      "https://editor.example.test",
    ]);
    expect(() => parseInvitationAllowedOrigins("null,,https://editor.example.test")).toThrow(
      "must not contain empty entries",
    );
  });

  it("gives trusted Host credentials enough default lifetime to delegate short invitations", () => {
    expect(parseIssuedTokenLifetime(undefined)).toBe(3_600);
    expect(parseIssuedTokenLifetime("300")).toBe(300);
    expect(() => parseIssuedTokenLifetime("1.5")).toThrow("--ttl must be an integer");
  });

  it("keeps the documented example document limit within the accepted server range", async () => {
    const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
    const configuredLimit = example
      .split(/\r?\n/u)
      .find((line) => line.startsWith("NEXUS_COLLAB_MAX_DOCUMENT_BYTES="))
      ?.split("=", 2)[1];

    expect(configuredLimit).toBe(String(8 * 1024 * 1024));
    expect(() => createCollaborationServer({
      address: "127.0.0.1",
      port: 0,
      storageDirectory: "/tmp/nexus-collab-env-example-validation",
      authSecret: "0123456789abcdef0123456789abcdef",
      maxDocumentBytes: Number(configuredLimit),
    })).not.toThrow();
  });
});
