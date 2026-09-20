import { describe, expect, it } from "vitest";
import {
  isExternalImageUrl,
  resolveImageReference,
  resolveVaultImagePath,
} from "../src/renderer/image-resolver";

describe("image resolver", () => {
  const vault = "D:\\Notes\\Vault";
  const active = "D:\\Notes\\Vault\\Projects\\Today.md";

  it("resolves a path relative to the active note", () => {
    expect(resolveVaultImagePath("../assets/photo.png", active, vault)).toBe("assets/photo.png");
  });

  it("keeps spaces and decodes URL-encoded spaces", () => {
    expect(resolveVaultImagePath("../assets/Pasted%20image.png", active, vault))
      .toBe("assets/Pasted image.png");
    expect(resolveVaultImagePath("../assets/Pasted image.png", active, vault))
      .toBe("assets/Pasted image.png");
  });

  it("rejects absolute paths and traversal outside the Vault", () => {
    expect(resolveVaultImagePath("../../outside.png", active, vault)).toBeNull();
    expect(resolveVaultImagePath("C:/secret.png", active, vault)).toBeNull();
    expect(resolveVaultImagePath("/secret.png", active, vault)).toBeNull();
  });

  it("preserves external image URLs", () => {
    expect(isExternalImageUrl("https://example.com/photo.png")).toBe(true);
    expect(isExternalImageUrl("data:image/png;base64,abc")).toBe(true);
    expect(resolveImageReference("https://example.com/photo.png", active, vault))
      .toEqual({ kind: "external", url: "https://example.com/photo.png" });
  });

  it("rejects unsupported schemes", () => {
    expect(isExternalImageUrl("file:///secret.png")).toBe(false);
    expect(resolveImageReference("file:///secret.png", active, vault)).toBeNull();
    expect(resolveImageReference("javascript:alert(1)", active, vault)).toBeNull();
  });
});
