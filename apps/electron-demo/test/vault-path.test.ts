import path from "node:path";
import { describe, expect, it } from "vitest";

import { assertPathInsideVault } from "../electron/vault-path";

describe("assertPathInsideVault", () => {
  const root = path.resolve("/tmp/nexus-vault");

  it("allows the vault root and descendants", () => {
    expect(assertPathInsideVault(root, root)).toBe(root);
    expect(assertPathInsideVault(root, path.join(root, "Notes/A.md"))).toBe(path.join(root, "Notes/A.md"));
  });

  it("rejects sibling paths with the same prefix", () => {
    expect(() => assertPathInsideVault(root, `${root}-other/A.md`)).toThrow(/escapes vault/);
  });

  it("rejects parent traversal outside the vault", () => {
    expect(() => assertPathInsideVault(root, path.join(root, "../outside.md"))).toThrow(/escapes vault/);
  });
});
