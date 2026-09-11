import { mkdtemp, mkdir, readFile, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublicDocumentHistory } from "../electron/public-document-history";

let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "nexus-public-history-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const key = "a".repeat(64);

describe("local document history policy", () => {
  it("caps history at 100 versions, expires after 30 days and never reuses old IDs", async () => {
    let now = Date.now();
    const store = new PublicDocumentHistory(root, () => now);
    const ids = new Set<string>();
    for (let index = 0; index < 101; index += 1) {
      const result = await store.append(key, { markdown: `version ${index}` });
      if (result.status !== "appended") throw new Error("Append failed");
      expect(ids.has(result.version.id)).toBe(false);
      ids.add(result.version.id);
    }
    const current = await store.read(key);
    expect(current.snapshot.versions).toHaveLength(100);
    expect(current.snapshot.versions[0].markdown).toBe("version 1");
    expect((await store.append(key, { markdown: "stale" }, "missing-head")).status).toBe("conflict");
    now += 31 * 24 * 60 * 60 * 1000;
    expect((await store.read(key)).snapshot.versions).toEqual([]);
    const next = await store.append(key, { markdown: "new month" });
    if (next.status !== "appended") throw new Error("Append failed");
    expect(ids.has(next.version.id)).toBe(false);
    expect((await store.read(key)).snapshot.versions).toHaveLength(1);
  });

  it("preserves unknown schemas instead of replacing them", async () => {
    const target = path.join(root, `${key}.json`);
    const source = JSON.stringify({ schemaVersion: 99, future: true });
    await writeFile(target, source);
    const store = new PublicDocumentHistory(root);
    await expect(store.append(key, { markdown: "new" })).rejects.toThrow("Unsupported history");
    expect(await readFile(target, "utf8")).toBe(source);
  });

  it("fails without publishing a new history file when the global quota is full", async () => {
    const directory = path.join(root, "history");
    await mkdir(directory);
    const occupied = path.join(directory, `${"b".repeat(64)}.json`);
    await writeFile(occupied, "");
    await truncate(occupied, 500 * 1024 * 1024);
    const store = new PublicDocumentHistory(directory);
    await expect(store.append(key, { markdown: "new" })).rejects.toThrow("500 MiB");
    await expect(readFile(path.join(directory, `${key}.json`))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
