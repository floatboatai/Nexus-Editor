import { mkdtemp, mkdir, open, readFile, readdir, realpath, rm, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeDocumentBytes, encodeDocumentText, type DocumentTextFormat } from "@floatboat/nexus-text-codec";
import { legacyTextCodec } from "@floatboat/nexus-text-codec/legacy";
import { ElectronVaultBroker, type SenderIdentity } from "../electron/plugin-host-broker";
import { PublicCapabilitiesServices } from "../electron/public-capabilities-services";
import { PublicDocumentHistory } from "../electron/public-document-history";
import type { PublicDocumentRead, PublicDocumentSaved, PublicImportedFile, PublicHistoryState } from "../src/shared/public-capabilities-ipc";

const sender: SenderIdentity = { id: 1, url: "http://trusted.local" };
const utf8: DocumentTextFormat = { encoding: "utf-8", bom: false, eol: "lf" };
let root: string;
let vaultRoot: string;
let broker: ElectronVaultBroker;
let service: PublicCapabilitiesServices;
let history: PublicDocumentHistory;
let enabled: Set<number>;
const chooseImport = vi.fn<() => Promise<string | null>>();
const chooseSave = vi.fn<() => Promise<string | null>>();
const chooseResourceDirectory = vi.fn<() => Promise<string | null>>();

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "nexus-public-services-"));
  vaultRoot = path.join(root, "vault");
  await mkdir(vaultRoot);
  enabled = new Set([1, 2]);
  broker = new ElectronVaultBroker({
    isSenderAuthorized: (source) => enabled.has(source.id),
    trashItem: async (absolutePath) => { await unlink(absolutePath); },
    watchFactory: () => ({ close() {} }),
    decodeText: (...args) => service.decodeVaultText(...args),
    encodeText: (...args) => service.encodeVaultText(...args),
  });
  history = new PublicDocumentHistory(path.join(root, "history"));
  chooseImport.mockReset();
  chooseSave.mockReset();
  chooseResourceDirectory.mockReset();
  service = new PublicCapabilitiesServices({
    broker, history, isEnabled: (source) => enabled.has(source.id),
    chooseImport, chooseSave, chooseResourceDirectory,
  });
});
afterEach(async () => {
  broker.closeAll();
  await rm(root, { recursive: true, force: true });
});

async function pick(name: string, content: Uint8Array | string): Promise<PublicImportedFile> {
  const target = path.join(vaultRoot, name);
  await writeFile(target, content);
  chooseImport.mockResolvedValue(target);
  return await service.invoke(sender, { operation: "pick-import" }) as PublicImportedFile;
}

describe("opt-in public file services", () => {
  it("inspects authorized metadata without reading a document body", async () => {
    const file = await pick("Note.md", "original");
    const read = vi.spyOn(broker, "readBinary");
    const metadata = await service.invoke(sender, { operation: "inspect-search-document", source: file.source }) as {
      status: string; size: number; metadataVersion: string; document?: unknown;
    };
    expect(metadata).toMatchObject({ status: "available", size: 8 });
    expect(metadata.metadataVersion).toMatch(/^metadata:/);
    expect(metadata.document).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
    const content = await service.invoke(sender, { operation: "inspect-search-document", source: file.source, includeContent: true }) as {
      metadataVersion: string; document: { text: string; version: string };
    };
    expect(content.metadataVersion).toBe(metadata.metadataVersion);
    expect(content.document).toMatchObject({ text: "original", version: file.version });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("returns explicit unavailable results for oversized and deleted files without a body read", async () => {
    const file = await pick("Large.md", "small");
    const target = path.join(vaultRoot, "Large.md");
    await truncate(target, 17 * 1024 * 1024);
    const read = vi.spyOn(broker, "readBinary");
    expect(await service.invoke(sender, { operation: "inspect-search-document", source: file.source })).toMatchObject({
      status: "available", size: 17 * 1024 * 1024,
    });
    expect(await service.invoke(sender, { operation: "inspect-search-document", source: file.source, includeContent: true })).toMatchObject({
      status: "unavailable", code: "too-large",
    });
    expect(read).not.toHaveBeenCalled();
    await unlink(target);
    expect(await service.invoke(sender, { operation: "inspect-search-document", source: file.source })).toMatchObject({
      status: "unavailable", code: "missing",
    });
  });

  it("keeps sender and session authorization failures fatal for search inspection", async () => {
    const file = await pick("Note.md", "original");
    await expect(service.invoke({ ...sender, id: 2 }, { operation: "inspect-search-document", source: file.source })).rejects.toThrow("authorized");
    const session = await broker.openSession(sender, vaultRoot, { watch: false });
    broker.closeSession(sender, session.sessionId);
    await expect(service.invoke(sender, {
      operation: "inspect-search-document", source: { kind: "vault", sessionId: session.sessionId, path: "Note.md" },
    })).rejects.toMatchObject({ code: "vault-session-invalid" });
    enabled.delete(sender.id);
    await expect(service.invoke(sender, { operation: "inspect-search-document", source: file.source })).rejects.toThrow("not enabled");
  });

  it("does not replace a confirmed encoding with a search-only automatic interpretation", async () => {
    const file = await pick("Ascii.md", "plain ASCII");
    await service.invoke(sender, { operation: "read", source: file.source, encoding: "gbk" });
    expect(await service.invoke(sender, { operation: "inspect-search-document", source: file.source, includeContent: true })).toMatchObject({
      status: "available", document: { format: { encoding: "utf-8" } },
    });
    expect(await service.invoke(sender, { operation: "read", source: file.source })).toMatchObject({
      status: "decoded", version: file.version, format: { encoding: "gbk" },
    });
  });

  it("rejects same-size in-place changes between a bounded read's stat snapshots", async () => {
    const target = path.join(vaultRoot, "Changing.md");
    await writeFile(target, "original");
    const canonicalTarget = await realpath(target);
    let armed = false;
    const openPath: typeof open = async (...args) => {
      const handle = await open(...args);
      if (args[0] === canonicalTarget) {
        const read = handle.readFile.bind(handle);
        vi.spyOn(handle, "readFile").mockImplementation(async () => {
          const content = await read();
          if (armed) {
            armed = false;
            await writeFile(target, "modified");
          }
          return content;
        });
      }
      return handle;
    };
    const inspectingBroker = new ElectronVaultBroker({
      isSenderAuthorized: (source) => enabled.has(source.id), trashItem: async () => undefined,
      watchFactory: () => ({ close() {} }), openPath,
    });
    const inspectingService = new PublicCapabilitiesServices({
      broker: inspectingBroker, history, isEnabled: (source) => enabled.has(source.id),
      chooseImport: async () => target, chooseSave, chooseResourceDirectory,
    });
    try {
      const selected = await inspectingService.invoke(sender, { operation: "pick-import" }) as PublicImportedFile;
      armed = true;
      expect(await inspectingService.invoke(sender, {
        operation: "inspect-search-document", source: selected.source, includeContent: true,
      })).toMatchObject({ status: "unavailable", code: "changed" });
      expect(armed).toBe(false);
      expect(await readFile(target, "utf8")).toBe("modified");
    } finally {
      inspectingBroker.closeAll();
    }
  });

  it("does not expose paths and rejects disabled or foreign window grants", async () => {
    const file = await pick("Note.md", "original");
    expect(JSON.stringify(file)).not.toContain(root);
    await expect(service.invoke({ ...sender, id: 2 }, { operation: "read", source: file.source })).rejects.toThrow("authorized");
    enabled.delete(1);
    await expect(service.invoke(sender, { operation: "pick-import" })).rejects.toThrow("not enabled");
  });

  it("keeps UTF-16 BOM/CRLF bytes and records baseline before the first successful save", async () => {
    const originalFormat: DocumentTextFormat = { encoding: "utf-16be", bom: true, eol: "crlf" };
    const original = encodeDocumentText("old\n中文", { format: originalFormat });
    const file = await pick("Note.md", original);
    const read = await service.invoke(sender, { operation: "read", source: file.source }) as PublicDocumentRead;
    expect(read).toMatchObject({ status: "decoded", text: "old\n中文", format: originalFormat });
    expect(read.version).toBe(file.version);
    const saved = await service.invoke(sender, {
      operation: "save", request: { source: file.source, markdown: "new\n中文", format: originalFormat, expectedVersion: read.version, history: true },
    }) as PublicDocumentSaved;
    expect(new Uint8Array(await readFile(path.join(vaultRoot, "Note.md")))).toEqual(encodeDocumentText("new\n中文", { format: originalFormat }));
    expect(saved.format).toEqual(originalFormat);
    const records = await service.invoke(sender, { operation: "history", source: file.source }) as PublicHistoryState;
    expect(records.snapshot.versions.map((record) => record.markdown)).toEqual(["old\n中文", "new\n中文"]);
    const names = await readdir(path.join(root, "history"));
    const envelope = JSON.parse(await readFile(path.join(root, "history", names[0]), "utf8"));
    expect(Object.values(envelope.raw)).toEqual(expect.arrayContaining([expect.objectContaining({ bytes: Buffer.from(original).toString("base64"), format: originalFormat })]));
  });

  it("reuses confirmed read versions across encoding changes and repeated attachment saves", async () => {
    const file = await pick("Legacy.md", legacyTextCodec.encode("中文初始内容", "gbk"));
    const read = await service.invoke(sender, { operation: "read", source: file.source, encoding: "gbk" }) as PublicDocumentRead;
    const nextFormat: DocumentTextFormat = { encoding: "utf-16le", bom: true, eol: "crlf" };
    const asset = { source: "nexus-asset:test/picture", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", suggestedName: "picture.png" };
    const request = { source: file.source, markdown: "![picture](nexus-asset:test/picture)\n", format: nextFormat,
      expectedVersion: read.version, assets: [asset], history: true };
    const saved = await service.invoke(sender, { operation: "save", request }) as PublicDocumentSaved;
    const reread = await service.invoke(sender, { operation: "read", source: saved.source }) as PublicDocumentRead;
    expect(reread).toMatchObject({ version: saved.version, status: "decoded", format: nextFormat });
    const again = await service.invoke(sender, { operation: "save", request: { ...request, expectedVersion: reread.version } }) as PublicDocumentSaved;
    expect(again.markdown).toBe(saved.markdown);
    expect(await readdir(path.join(vaultRoot, "_assets"))).toHaveLength(1);
  });

  it("requests a legacy choice and never writes unrepresentable text", async () => {
    const data = legacyTextCodec.encode("中文", "gbk");
    const file = await pick("Legacy.md", data);
    expect(await service.invoke(sender, { operation: "read", source: file.source })).toMatchObject({ status: "needs-encoding" });
    const decoded = await service.invoke(sender, { operation: "read", source: file.source, encoding: "gbk" }) as PublicDocumentRead;
    expect(decoded).toMatchObject({ status: "decoded", text: "中文" });
    if (decoded.status !== "decoded") throw new Error("Expected decoded content");
    await expect(service.invoke(sender, { operation: "save", request: {
      source: file.source, markdown: "😀", format: decoded.format, expectedVersion: file.version, history: false,
      assets: [{ source: "nexus-asset:rollback/image", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
    } })).rejects.toThrow();
    expect(new Uint8Array(await readFile(path.join(vaultRoot, "Legacy.md")))).toEqual(data);
    expect(await readdir(path.join(vaultRoot, "_assets"))).toHaveLength(0);
  });

  it("removes newly created attachments when the document CAS rejects the save", async () => {
    const file = await pick("Conflict.md", "original");
    await writeFile(path.join(vaultRoot, "Conflict.md"), "external edit");
    await expect(service.invoke(sender, { operation: "save", request: {
      source: file.source, markdown: "![x](nexus-asset:conflict/image)", format: utf8,
      expectedVersion: file.version, history: false,
      assets: [{ source: "nexus-asset:conflict/image", bytes: new Uint8Array([4, 5, 6]), mimeType: "image/png" }],
    } })).rejects.toMatchObject({ code: "vault-version-conflict" });
    expect(await readdir(path.join(vaultRoot, "_assets"))).toHaveLength(0);
    expect(await readFile(path.join(vaultRoot, "Conflict.md"), "utf8")).toBe("external edit");
  });

  it("rejects byte-format-only changes and serializes competing writes across sessions", async () => {
    const target = path.join(vaultRoot, "Note.md");
    await writeFile(target, "same");
    const first = await broker.openSession(sender, vaultRoot);
    const secondSender = { ...sender, id: 2 };
    const second = await broker.openSession(secondSender, vaultRoot);
    const initial = await broker.readBinary(sender, first.sessionId, "Note.md");
    await writeFile(target, encodeDocumentText("same", { format: { ...utf8, bom: true } }));
    await expect(broker.write(sender, first.sessionId, "Note.md", "stale", { expectedVersion: initial.version })).rejects.toMatchObject({ code: "vault-version-conflict" });
    const current = await broker.readBinary(sender, first.sessionId, "Note.md");
    const results = await Promise.allSettled([
      broker.write(sender, first.sessionId, "Note.md", "first", { expectedVersion: current.version }),
      broker.write(secondSender, second.sessionId, "Note.md", "second", { expectedVersion: current.version }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("checks authorization again after waiting for another writer", async () => {
    await writeFile(path.join(vaultRoot, "Note.md"), "original");
    const first = await broker.openSession(sender, vaultRoot);
    const secondSender = { ...sender, id: 2 };
    const second = await broker.openSession(secondSender, vaultRoot);
    let release: (() => void) | undefined;
    const blocking = broker.write(sender, first.sessionId, "Note.md", "first", {
      beforeCommit: () => new Promise<void>((resolve) => { release = resolve; }),
    });
    await vi.waitFor(() => expect(release).toBeDefined());
    const waiting = broker.write(secondSender, second.sessionId, "Note.md", "second");
    const rejection = expect(waiting).rejects.toThrow();
    broker.closeSession(secondSender, second.sessionId);
    release?.();
    await blocking;
    await rejection;
    expect(await readFile(path.join(vaultRoot, "Note.md"), "utf8")).toBe("first");
  });

  it("rechecks raw bytes after a slow pre-commit history step", async () => {
    const target = path.join(vaultRoot, "Note.md");
    await writeFile(target, "original");
    const session = await broker.openSession(sender, vaultRoot);
    const original = await broker.readBinary(sender, session.sessionId, "Note.md");
    await expect(broker.write(sender, session.sessionId, "Note.md", "stale", {
      expectedVersion: original.version,
      beforeCommit: async () => { await writeFile(target, "external edit"); },
    })).rejects.toMatchObject({ code: "vault-version-conflict" });
    expect(await readFile(target, "utf8")).toBe("external edit");
  });

  it("requires explicit image-directory authorization for selected files", async () => {
    const file = await pick("Note.md", "![image](image.png)");
    const image = new Uint8Array([137, 80, 78, 71]);
    await writeFile(path.join(vaultRoot, "image.png"), image);
    expect(await service.invoke(sender, { operation: "asset", source: file.source, reference: "image.png" })).toBeNull();
    chooseResourceDirectory.mockResolvedValue(null);
    expect(await service.invoke(sender, { operation: "grant-resource-directory", source: file.source })).toBe(false);
    chooseResourceDirectory.mockResolvedValue(vaultRoot);
    expect(await service.invoke(sender, { operation: "grant-resource-directory", source: file.source })).toBe(true);
    expect(await service.invoke(sender, { operation: "asset", source: file.source, reference: "image.png" })).toMatchObject({ bytes: image, mimeType: "image/png" });
    await writeFile(path.join(root, "outside.png"), image);
    expect(await service.invoke(sender, { operation: "asset", source: file.source, reference: "../outside.png" })).toBeNull();
    await symlink(path.join(root, "outside.png"), path.join(vaultRoot, "escape.png"));
    expect(await service.invoke(sender, { operation: "asset", source: file.source, reference: "escape.png" })).toBeNull();
  });

  it("commits attachments before rewriting a new Markdown document and refuses converted-source overwrite", async () => {
    const imported = await pick("Original.html", "<h1>Original</h1>");
    await expect(service.invoke(sender, { operation: "save", request: {
      source: imported.source, markdown: "converted", format: utf8, expectedVersion: imported.version, history: false,
    } })).rejects.toThrow("cannot be overwritten");
    chooseSave.mockResolvedValue(path.join(vaultRoot, "Converted.md"));
    const result = await service.invoke(sender, { operation: "save", request: {
      source: null, markdown: "![x](nexus-asset:import/1)", format: utf8, history: false,
      assets: [{ source: "nexus-asset:import/1", suggestedName: "../evil.png", bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" }],
    } }) as PublicDocumentSaved;
    expect(result.markdown).toMatch(/_assets\/[a-f0-9]{32}\.png/);
    expect(await readFile(path.join(vaultRoot, "Original.html"), "utf8")).toBe("<h1>Original</h1>");
    expect(await readdir(path.join(vaultRoot, "_assets"))).toHaveLength(1);
    expect(decodeDocumentBytes(await readFile(path.join(vaultRoot, "Converted.md")))).toMatchObject({ text: result.markdown });
  });

  it("reports post-save history failure separately from disk success", async () => {
    const file = await pick("Note.md", "original");
    const append = vi.spyOn(history, "append");
    append.mockRejectedValueOnce(new Error("baseline unavailable"));
    await expect(service.invoke(sender, { operation: "save", request: {
      source: file.source, markdown: "not-written", format: utf8, expectedVersion: file.version, history: true,
    } })).rejects.toThrow("baseline unavailable");
    expect(await readFile(path.join(vaultRoot, "Note.md"), "utf8")).toBe("original");
    append.mockRestore();
    const originalAppend = history.append.bind(history);
    vi.spyOn(history, "append").mockImplementation((key, entry, ...args) => entry.reason === "saved"
      ? Promise.reject(new Error("history quota reached")) : originalAppend(key, entry, ...args));
    const saved = await service.invoke(sender, { operation: "save", request: {
      source: file.source, markdown: "written", format: utf8, expectedVersion: file.version, history: true,
    } }) as PublicDocumentSaved;
    expect(saved.historyWarning).toBe("history quota reached");
    expect(await readFile(path.join(vaultRoot, "Note.md"), "utf8")).toBe("written");
  });
});
