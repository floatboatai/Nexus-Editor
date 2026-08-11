import { describe, expect, it } from "vitest";
import { imageFileToDataUrl } from "../src/renderer/pasted-image";

describe("imageFileToDataUrl", () => {
  it("encodes an image for an untitled document", async () => {
    const file = new File(["image"], "screenshot.png", { type: "image/png" });

    await expect(imageFileToDataUrl(file)).resolves.toBe("data:image/png;base64,aW1hZ2U=");
  });

  it("rejects unsupported and empty clipboard images", async () => {
    await expect(
      imageFileToDataUrl(new File(["<svg/>"], "image.svg", { type: "image/svg+xml" }))
    ).rejects.toThrow("Unsupported pasted image type");
    await expect(
      imageFileToDataUrl(new File([], "empty.png", { type: "image/png" }))
    ).rejects.toThrow("Pasted image is empty");
  });
});
