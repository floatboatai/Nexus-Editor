// @vitest-environment node

import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { atomicWriteFile } from "../electron/atomic-file";

const fsHarness = vi.hoisted(() => ({ rename: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  fsHarness.rename.mockImplementation(actual.rename);
  return { ...actual, rename: fsHarness.rename };
});

const roots: string[] = [];

async function fixture(name: string): Promise<{ root: string; target: string }> {
  const root = await mkdtemp(path.join(tmpdir(), `${name}-`));
  roots.push(root);
  return { root, target: path.join(root, "state.json") };
}

afterEach(async () => {
  fsHarness.rename.mockClear();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("atomicWriteFile", () => {
  it("replaces the target with a complete payload and leaves no temporary sibling", async () => {
    const { root, target } = await fixture("nexus-atomic-file");
    await writeFile(target, "old");

    await atomicWriteFile(target, "new");

    await expect(readFile(target, "utf8")).resolves.toBe("new");
    await expect(readdir(root)).resolves.toEqual(["state.json"]);
  });

  it("preserves the target and original error when replacement fails", async () => {
    const { root, target } = await fixture("nexus-atomic-file-failure");
    const renameError = new Error("rename failed");
    await writeFile(target, "old");
    fsHarness.rename.mockImplementationOnce(async (source: string, destination: string) => {
      expect(destination).toBe(target);
      expect(source).not.toBe(target);
      expect(path.dirname(source)).toBe(root);
      expect(path.basename(source)).toMatch(/^\.state\.json\..+\.tmp$/u);
      await expect(readFile(target, "utf8")).resolves.toBe("old");
      throw renameError;
    });

    await expect(atomicWriteFile(target, "new")).rejects.toBe(renameError);
    await expect(readFile(target, "utf8")).resolves.toBe("old");
    await expect(readdir(root)).resolves.toEqual(["state.json"]);
  });
});
