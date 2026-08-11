import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_PASTED_IMAGE_BYTES,
  savePastedImage,
} from "../electron/asset-storage";

const tempRoots: string[] = [];

async function createVault(): Promise<{ root: string; note: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "nexus-paste-image-"));
  tempRoots.push(root);
  const noteDir = path.join(root, "notes");
  await mkdir(noteDir, { recursive: true });
  return { root, note: path.join(noteDir, "note.md") };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("savePastedImage", () => {
  it("stores an image in the vault and returns a note-relative Markdown URL", async () => {
    const { root, note } = await createVault();
    const data = new Uint8Array([137, 80, 78, 71]);

    const saved = await savePastedImage(root, note, {
      name: "screen shot.png",
      type: "image/png",
      data,
    });

    expect(saved.path).toBe(path.join(root, "assets", "screen shot.png"));
    expect(saved.url).toBe("../assets/screen%20shot.png");
    expect(new Uint8Array(await readFile(saved.path))).toEqual(data);
  });

  it("uses the MIME type for the extension and avoids overwriting existing images", async () => {
    const { root, note } = await createVault();
    const image = {
      name: "capture.jpg",
      type: "image/png",
      data: new Uint8Array([1, 2, 3]),
    };

    const first = await savePastedImage(root, note, image);
    const second = await savePastedImage(root, note, image);

    expect(first.path).toBe(path.join(root, "assets", "capture.png"));
    expect(second.path).toBe(path.join(root, "assets", "capture-1.png"));
  });

  it("sanitizes file names that are unsafe on Windows", async () => {
    const { root, note } = await createVault();

    const saved = await savePastedImage(root, note, {
      name: "CON.png",
      type: "image/png",
      data: new Uint8Array([1]),
    });

    expect(saved.path).toBe(path.join(root, "assets", "_CON.png"));
  });

  it("rejects unsupported, empty, oversized, and out-of-vault inputs", async () => {
    const { root, note } = await createVault();
    const valid = { name: "image.png", type: "image/png", data: new Uint8Array([1]) };

    await expect(
      savePastedImage(root, note, { ...valid, type: "image/svg+xml" })
    ).rejects.toThrow("Unsupported pasted image type");
    await expect(
      savePastedImage(root, note, { ...valid, data: new Uint8Array() })
    ).rejects.toThrow("Pasted image is empty");
    await expect(
      savePastedImage(root, note, {
        ...valid,
        data: new Uint8Array(MAX_PASTED_IMAGE_BYTES + 1),
      })
    ).rejects.toThrow("20 MB limit");
    await expect(savePastedImage(root, path.join(root, "..", "outside.md"), valid)).rejects.toThrow(
      "escapes vault"
    );
  });
});
