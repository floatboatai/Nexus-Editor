import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryDocumentVersionStore } from "@floatboat/nexus-document-history";
import { decodeDocumentBytes, encodeDocumentText, type DocumentTextFormat, type TextEncoding } from "@floatboat/nexus-text-codec";
import { legacyTextCodec } from "@floatboat/nexus-text-codec/legacy";
import type { SearchExecutor } from "@floatboat/nexus-plugin-search/workspace";
import { scanSearchDocument } from "../../../packages/plugin-search/src/search-matcher";
import type { ConversionExecutor } from "@floatboat/nexus-document";
import type { PublicCapabilitiesBridge, PublicDocumentRead, PublicDocumentSaveRequest, PublicDocumentSource, PublicImportedFile } from "../src/shared/public-capabilities-ipc";
import type { IpcContentVersion, PluginVaultChangeEvent, VaultSessionId } from "../src/shared/plugin-ipc";
import { bootPublicCapabilitiesDemo, type PublicCapabilitiesDemo } from "../src/renderer/public-capabilities-demo";

vi.mock("@floatboat/nexus-plugin-search/search-worker?worker&inline", () => ({ default: class {} }));
vi.mock("@floatboat/nexus-document/worker-browser?worker&inline", () => ({ default: class {} }));

const demos: PublicCapabilitiesDemo[] = [];
const format: DocumentTextFormat = { encoding: "utf-8", bom: false, eol: "lf" };
const vaultSession = "11111111-1111-4111-8111-111111111111" as VaultSessionId;
afterEach(async () => {
  await Promise.all(demos.splice(0).map((demo) => demo.destroy()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "nexusHost");
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function key(source: PublicDocumentSource): string { return source.kind === "selected" ? source.id : source.path; }
function chosen(name: string, text: string, id = name): PublicImportedFile {
  return { name, bytes: new TextEncoder().encode(text), source: { kind: "selected", id }, version: "v1" };
}
function executor(): SearchExecutor {
  return { scan: async (request) => scanSearchDocument(request), dispose: vi.fn() };
}
function harness() {
  const files = new Map<string, { name: string; text: string; version: string; format: DocumentTextFormat; size?: number }>([
    ["A.md", { name: "A.md", text: "alpha current", version: "A-v1", format }],
    ["B.md", { name: "B.md", text: "beta other", version: "B-v1", format }],
  ]);
  const histories = new Map<string, MemoryDocumentVersionStore>();
  const history = (source: PublicDocumentSource) => {
    const id = key(source);
    if (!histories.has(id)) histories.set(id, new MemoryDocumentVersionStore());
    return histories.get(id) as MemoryDocumentVersionStore;
  };
  let watch: ((event: PluginVaultChangeEvent) => void) | undefined;
  const saveResult = (request: PublicDocumentSaveRequest) => {
    const source = request.source ?? { kind: "selected" as const, id: "saved-new.md" };
    return { source, name: request.name ?? "saved.md", markdown: request.markdown, format: request.format, version: "saved-v2" };
  };
  const bridge: PublicCapabilitiesBridge = {
    pickImport: vi.fn(async () => chosen("A.md", "alpha current")),
    readDocument: vi.fn(async (source: PublicDocumentSource, encoding?: TextEncoding): Promise<PublicDocumentRead> => {
      const file = files.get(key(source));
      if (!file) throw new Error("Missing fixture");
      if ((file.size ?? 0) > 16 * 1024 * 1024) throw new RangeError("File exceeds the byte limit");
      if (encoding) {
        const bytes = encodeDocumentText(file.text, { format: file.format, legacyCodec: legacyTextCodec });
        return { ...decodeDocumentBytes(bytes, { encoding, legacyCodec: legacyTextCodec }), name: file.name, version: file.version };
      }
      return { status: "decoded", text: file.text, name: file.name, version: file.version, format: file.format };
    }),
    readAsset: vi.fn(async () => null),
    grantResourceDirectory: vi.fn(async () => false),
    saveDocument: vi.fn(async (request) => {
      const saved = saveResult(request);
      files.set(key(saved.source), { name: saved.name, text: saved.markdown, version: saved.version, format: saved.format });
      if (request.history) await history(saved.source).append(key(saved.source), { markdown: saved.markdown, reason: "saved" });
      return saved;
    }),
    history: vi.fn(async (source) => ({ documentKey: key(source), snapshot: history(source).exportSnapshot(), head: (await history(source).list(key(source))).head })),
    appendHistory: vi.fn(async (source, record, expectedHead) => history(source).append(key(source), record, { expectedHead })),
    exportHtml: vi.fn(async () => true),
    cancelShutdown: vi.fn(async () => undefined),
  };
  const inspectSearchDocument = vi.fn(async (source: PublicDocumentSource, options: { includeContent?: boolean; encoding?: TextEncoding } = {}) => {
    const file = files.get(key(source));
    if (!file) return { status: "unavailable" as const, name: key(source), code: "missing" as const, message: "文件已删除" };
    const size = file.size ?? new TextEncoder().encode(file.text).byteLength;
    const metadata = { status: "available" as const, name: file.name, size, metadataVersion: `fixture:${file.version}` };
    if (!options.includeContent) return metadata;
    if (size > 2 * 1024 * 1024) return { status: "unavailable" as const, name: file.name, code: "too-large" as const, message: "文件超过搜索限额" };
    return { ...metadata, document: { status: "decoded" as const, name: file.name, text: file.text, format: file.format, version: file.version } };
  });
  Object.assign(bridge, { inspectSearchDocument });
  const plugins = { vault: {
    pick: vi.fn(async () => ({ sessionId: vaultSession, name: "Fixture Vault" })),
    list: vi.fn(async () => [...files.values()].map((file) => ({ kind: "file" as const, name: file.name, path: file.name }))),
    commit: vi.fn(async () => ({ ok: true as const })),
    close: vi.fn(async () => ({ ok: true as const })),
    onChanged: vi.fn((callback: (event: PluginVaultChangeEvent) => void) => { watch = callback; return () => { watch = undefined; }; }),
  } };
  const conversion: ConversionExecutor = { run: vi.fn(async () => ({ markdown: "# Converted", assetPlan: [], diagnostics: [] })), dispose: vi.fn(async () => undefined) };
  const confirm = vi.fn(() => true);
  const root = document.createElement("div"); root.id = "app"; document.body.append(root);
  return { bridge, plugins, conversion, confirm, root, files, histories, history, saveResult, inspectSearchDocument, watch: (event: PluginVaultChangeEvent) => watch?.(event) };
}
async function setup() {
  const h = harness();
  const demo = await bootPublicCapabilitiesDemo({ root: h.root, bridge: h.bridge, plugins: h.plugins, confirmDiscard: h.confirm, createSearchExecutor: executor, conversionExecutor: h.conversion });
  demos.push(demo);
  const control = <T extends HTMLElement = HTMLElement>(label: string): T => {
    const value = h.root.querySelector<T>(`[aria-label='${label}']`);
    if (!value) throw new Error(`Missing control ${label}`);
    return value;
  };
  return { ...h, demo, control };
}

describe("opt-in public capabilities renderer", () => {
  it("exposes minimal controls and uses headless search without default search/toolbar UI", async () => {
    const { root, control, demo } = await setup();
    for (const label of ["打开 Markdown", "保存", "选择 Vault", "插入表格", "块公式", "行内公式", "Mermaid", "文内查找", "跨文档搜索", "导入 HTML/CSV/DOCX/PDF", "离线 HTML", "授权图片目录"]) expect(control(label)).toBeTruthy();
    expect(root.querySelector(".nexus-toolbar")).toBeNull();
    expect(root.querySelector(".cm-search")).toBeNull();
    expect(demo.getState().dirty).toBe(false);
    expect(demo.editor.runCommand("template:insert-inline-math")).toBe(true);
  });

  it("protects dirty content before opening and does not show a picker after cancellation", async () => {
    const { demo, bridge, confirm } = await setup();
    demo.editor.setDocument("unsaved user input");
    confirm.mockReturnValue(false);
    await expect(demo.openDocument()).rejects.toMatchObject({ name: "AbortError" });
    expect(bridge.pickImport).not.toHaveBeenCalled();
    expect(demo.editor.getDocument()).toBe("unsaved user input");
  });

  it("rejects new input received while the file picker was open", async () => {
    const { demo, bridge } = await setup();
    const picker = deferred<PublicImportedFile | null>();
    vi.mocked(bridge.pickImport).mockReturnValue(picker.promise);
    const opening = demo.openDocument();
    await vi.waitFor(() => expect(bridge.pickImport).toHaveBeenCalled());
    demo.editor.setDocument("typed after opening dialog");
    picker.resolve(chosen("A.md", "alpha current"));
    await expect(opening).rejects.toThrow("新的编辑");
    expect(demo.editor.getDocument()).toBe("typed after opening dialog");
  });

  it("does not select an encoding candidate until the user confirms it", async () => {
    const { demo, bridge, control } = await setup();
    vi.mocked(bridge.readDocument).mockResolvedValueOnce({ name: "A.md", version: "raw-gbk", status: "needs-encoding", candidates: ["gbk", "gb18030"], reason: "invalid-utf8" });
    await demo.openDocument();
    expect(demo.getState().source).toBeNull();
    expect(control<HTMLSelectElement>("文本编码").value).toBe("");
    vi.mocked(bridge.readDocument).mockResolvedValueOnce({ name: "A.md", version: "raw-gbk", status: "decoded", text: "中文", format: { ...format, encoding: "gbk" } });
    control<HTMLSelectElement>("文本编码").value = "gbk";
    await demo.confirmEncoding();
    expect(bridge.readDocument).toHaveBeenLastCalledWith({ kind: "selected", id: "A.md" }, "gbk");
    expect(demo.editor.getDocument()).toBe("中文");
    expect(demo.getState().version).toBe("raw-gbk");
  });

  it("freezes save source/version/snapshot and retains edits and encoding changes during IO", async () => {
    const { demo, bridge, control, saveResult } = await setup();
    await demo.openDocument();
    demo.editor.setDocument("snapshot to save");
    const gate = deferred<Awaited<ReturnType<PublicCapabilitiesBridge["saveDocument"]>>>();
    vi.mocked(bridge.saveDocument).mockReturnValue(gate.promise);
    const saving = demo.save();
    await vi.waitFor(() => expect(bridge.saveDocument).toHaveBeenCalled());
    const request = vi.mocked(bridge.saveDocument).mock.calls[0][0];
    expect(request).toMatchObject({ source: { kind: "selected", id: "A.md" }, expectedVersion: "A-v1", markdown: "snapshot to save", format });
    demo.editor.setDocument("newer input");
    const encoding = control<HTMLSelectElement>("文本编码"); encoding.value = "gbk"; encoding.dispatchEvent(new Event("change"));
    gate.resolve({ ...saveResult(request), markdown: "rewritten snapshot" });
    await saving;
    expect(demo.editor.getDocument()).toBe("newer input");
    expect(demo.getState()).toMatchObject({ dirty: true, version: "saved-v2", format: { encoding: "gbk" } });
  });

  it("does not advance the save baseline on a watcher event or failed CAS", async () => {
    const { demo, bridge, control, watch } = await setup();
    await demo.chooseVault(); control<HTMLSelectElement>("Vault 文档").value = "A.md"; await demo.openSelectedFile();
    demo.editor.setDocument("local edits");
    watch({ sessionId: vaultSession, kind: "modify", path: "A.md", version: "disk-v2" as IpcContentVersion, origin: "external" });
    vi.mocked(bridge.saveDocument).mockRejectedValueOnce(new Error("version conflict"));
    await expect(demo.save()).rejects.toThrow("version conflict");
    expect(bridge.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: "A-v1", markdown: "local edits" }));
    expect(demo.getState()).toMatchObject({ version: "A-v1", dirty: true });
  });

  it("imports into an unbound buffer and cannot overwrite the original file", async () => {
    const { demo, bridge } = await setup();
    await demo.openDocument();
    vi.mocked(bridge.pickImport).mockResolvedValueOnce(chosen("table.csv", "name,value\n中文,2", "csv-original"));
    await demo.importDocument();
    expect(demo.getState()).toMatchObject({ source: null, version: undefined, name: "table.md", dirty: true });
    expect(demo.editor.getDocument()).toContain("中文");
    await demo.save();
    expect(bridge.saveDocument).toHaveBeenLastCalledWith(expect.objectContaining({ source: null, expectedVersion: undefined }));
  });

  it("uses the isolated binary conversion executor and refuses stale results", async () => {
    const { demo, bridge, conversion } = await setup();
    vi.mocked(bridge.pickImport).mockResolvedValueOnce(chosen("paper.docx", "binary-placeholder"));
    const converted = deferred<Awaited<ReturnType<ConversionExecutor["run"]>>>();
    vi.mocked(conversion.run).mockReturnValue(converted.promise);
    const importing = demo.importDocument();
    await vi.waitFor(() => expect(conversion.run).toHaveBeenCalled());
    demo.editor.setDocument("input while converting");
    converted.resolve({ markdown: "converted old result", assetPlan: [], diagnostics: [] });
    await expect(importing).rejects.toThrow("新的编辑");
    expect(demo.editor.getDocument()).toBe("input while converting");
  });

  it("preserves conversion asset bytes for save, preview and undo of rewritten links", async () => {
    const { demo, bridge, conversion, saveResult } = await setup();
    vi.mocked(bridge.pickImport).mockResolvedValueOnce(chosen("images.docx", "fixture"));
    const bytes = new Uint8Array([137, 80, 78, 71]);
    vi.mocked(conversion.run).mockResolvedValueOnce({ markdown: "![image](nexus-asset:fixture/1)", assetPlan: [{ source: "nexus-asset:fixture/1", suggestedName: "one.png", resource: { bytes, mimeType: "image/png" } }], diagnostics: [] });
    await demo.importDocument();
    vi.mocked(bridge.saveDocument).mockImplementationOnce(async (request) => ({ ...saveResult(request), markdown: "![image](assets/one.png)" }));
    await demo.save();
    expect(bridge.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ assets: [{ source: "nexus-asset:fixture/1", suggestedName: "one.png", bytes, mimeType: "image/png" }] }));
    expect(demo.editor.getDocument()).toBe("![image](assets/one.png)");
    demo.editor.undo();
    expect(demo.editor.getDocument()).toContain("nexus-asset:fixture/1");
  });

  it("stages managed paste bytes and cancels late uploads when the document changes", async () => {
    const { demo, root, bridge } = await setup();
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const file = new File([bytes], "pasted.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => bytes.buffer });
    demo.editor.setSelection(0);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { files: [file] } });
    root.querySelector(".cm-content")?.dispatchEvent(event);
    await vi.waitFor(() => expect(demo.editor.getDocument()).toContain("nexus-asset:"));
    await demo.save();
    expect(bridge.saveDocument).toHaveBeenCalledWith(expect.objectContaining({ assets: [expect.objectContaining({ suggestedName: "pasted.png", bytes })] }));
    const pending = deferred<ArrayBuffer>();
    const delayed = new File([bytes], "late.png", { type: "image/png" });
    Object.defineProperty(delayed, "arrayBuffer", { value: () => pending.promise });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [delayed] } });
    root.querySelector(".cm-content")?.dispatchEvent(paste);
    vi.mocked(bridge.pickImport).mockResolvedValueOnce(chosen("B.md", "beta other"));
    await demo.openDocument(); pending.resolve(bytes.buffer);
    await Promise.resolve();
    expect(demo.editor.getDocument()).toBe("beta other");
  });

  it("requires explicit resource-directory authorization for an HTML image import", async () => {
    const { demo, bridge, confirm } = await setup();
    vi.mocked(bridge.pickImport).mockResolvedValueOnce(chosen("page.html", '<h1>Title</h1><img src="image.png">', "html-source"));
    confirm.mockReturnValue(true);
    await demo.importDocument();
    expect(bridge.grantResourceDirectory).toHaveBeenCalledWith({ kind: "selected", id: "html-source" });
    expect(bridge.readAsset).toHaveBeenCalledWith({ kind: "selected", id: "html-source" }, "image.png");
    expect(demo.getState().source).toBeNull();
    expect(demo.editor.getDocument()).toContain("Title");
  });

  it("records a recovery checkpoint and restores only buffer content, not encoding or disk version", async () => {
    const { demo, bridge, control, history } = await setup();
    await demo.openDocument();
    const source: PublicDocumentSource = { kind: "selected", id: "A.md" };
    const version = await history(source).append("A.md", { markdown: "historical text", reason: "saved" });
    if (version.status !== "appended") throw new Error("Missing version");
    control<HTMLInputElement>("显式启用保存历史").checked = true;
    await demo.loadHistory(); control<HTMLSelectElement>("内容版本").value = version.version.id;
    const encoding = control<HTMLSelectElement>("文本编码"); encoding.value = "gbk"; encoding.dispatchEvent(new Event("change"));
    demo.editor.setDocument("before restore unsaved");
    await demo.restoreVersion();
    expect(demo.editor.getDocument()).toBe("historical text");
    expect(demo.getState()).toMatchObject({ version: "A-v1", format: { encoding: "gbk" }, dirty: true });
    expect(bridge.appendHistory).toHaveBeenCalledWith(source, expect.objectContaining({ markdown: "before restore unsaved", reason: "before-restore" }), version.version.id);
    expect(bridge.saveDocument).not.toHaveBeenCalled();
    expect(demo.editor.undo()).toBe(true); expect(demo.editor.getDocument()).toBe("before restore unsaved");
  });

  it("hydrates 22 one-MiB history versions accepted by the backend policy", async () => {
    const { demo, control, histories } = await setup();
    await demo.openDocument();
    const store = new MemoryDocumentVersionStore({ maxDocuments: 1, maxBytesPerDocument: 32 * 1024 * 1024, maxTotalBytes: 32 * 1024 * 1024 });
    const markdown = "x".repeat(1024 * 1024);
    for (let index = 0; index < 22; index += 1) await store.append("A.md", { markdown, label: `version ${index}` });
    histories.set("A.md", store);
    control<HTMLInputElement>("显式启用保存历史").checked = true;
    await expect(demo.loadHistory()).resolves.toBeUndefined();
    expect(control<HTMLSelectElement>("内容版本").options).toHaveLength(22);
  });

  it("enumerates only metadata before bounded search reads and skips oversized or deleted files explicitly", async () => {
    const { demo, bridge, control, files, plugins, inspectSearchDocument } = await setup();
    files.set("Large.md", { name: "Large.md", text: "must not read this", version: "large-v1", format, size: 17 * 1024 * 1024 });
    await demo.chooseVault();
    vi.mocked(plugins.vault.list).mockResolvedValueOnce([
      { kind: "file", name: "A.md", path: "A.md" },
      { kind: "file", name: "Large.md", path: "Large.md" },
      { kind: "file", name: "Deleted.md", path: "Deleted.md" },
    ]);
    await demo.chooseVault();
    control<HTMLInputElement>("查找内容").value = "alpha";
    await demo.searchWorkspace();
    expect(control("跨文档搜索结果").textContent).toContain("A.md");
    expect(bridge.readDocument).not.toHaveBeenCalled();
    expect(inspectSearchDocument.mock.calls.filter(([source, options]) => key(source) === "Large.md" && options?.includeContent)).toHaveLength(0);
    expect(inspectSearchDocument.mock.calls.some(([, options]) => options?.includeContent)).toBe(true);
    expect(control("跨文档搜索诊断").textContent).toContain("Large.md");
    expect(control("跨文档搜索诊断").textContent).toContain("Deleted.md");
  });

  it("continues after a document disappears between metadata enumeration and its body read", async () => {
    const { demo, control, inspectSearchDocument } = await setup();
    await demo.chooseVault();
    const inspect = inspectSearchDocument.getMockImplementation();
    if (!inspect) throw new Error("Missing search fixture");
    inspectSearchDocument.mockImplementation(async (source, options) => {
      if (key(source) === "B.md" && options?.includeContent) return { status: "unavailable", name: "B.md", code: "missing", message: "文件已删除" };
      return inspect(source, options);
    });
    control<HTMLInputElement>("查找内容").value = "a";
    await demo.searchWorkspace();
    expect(control("跨文档搜索结果").textContent).toContain("A.md");
    expect(control("跨文档搜索诊断").textContent).toContain("B.md");
    expect(control("跨文档搜索诊断").textContent).toContain("已删除");
  });

  it("reports an older host's missing optional metadata capability instead of pre-reading every body", async () => {
    const { demo, bridge, control, root } = await setup();
    Reflect.deleteProperty(bridge, "inspectSearchDocument");
    await demo.chooseVault();
    control<HTMLInputElement>("查找内容").value = "alpha";
    await demo.searchWorkspace();
    expect(bridge.readDocument).not.toHaveBeenCalled();
    expect(root.textContent).toContain("没有搜索元数据能力");
  });

  it("searches the full authorized Vault, ranks files, and refuses stale disk hits", async () => {
    const { demo, control, files } = await setup();
    await demo.chooseVault();
    const query = control<HTMLInputElement>("查找内容"); query.value = "beta";
    await demo.searchWorkspace();
    const hit = control("跨文档搜索结果").querySelector<HTMLButtonElement>("button");
    expect(hit?.textContent).toContain("B.md");
    files.set("B.md", { name: "B.md", text: "changed externally", version: "B-v2", format });
    hit?.click();
    await vi.waitFor(() => expect(control("跨文档搜索结果").textContent).not.toContain("beta other"));
    expect(demo.editor.getDocument()).toBe("");
    const names = control<HTMLInputElement>("模糊查找文件"); names.value = "b"; names.dispatchEvent(new Event("input"));
    expect(Array.from(control<HTMLSelectElement>("Vault 文档").options).map((option) => option.value)).toEqual(["B.md"]);
  });

  it("uses active unsaved content for search and custom controls for headless replacement", async () => {
    const { demo, control } = await setup();
    await demo.chooseVault(); control<HTMLSelectElement>("Vault 文档").value = "A.md"; await demo.openSelectedFile();
    demo.editor.setDocument("fresh unsaved fresh");
    control<HTMLInputElement>("查找内容").value = "fresh";
    await demo.searchWorkspace();
    expect(control("跨文档搜索结果").textContent).toContain("fresh unsaved fresh");
    await demo.findInDocument(); control<HTMLInputElement>("替换内容").value = "new"; control("全部替换").click();
    await vi.waitFor(() => expect(demo.editor.getDocument()).toBe("new unsaved new"));
    expect(document.querySelector(".cm-search")).toBeNull();
  });

  it("exports self-contained HTML without changing the buffer or saving Markdown", async () => {
    const { demo, bridge } = await setup();
    demo.editor.setDocument("# Export me\n\nBody");
    await demo.exportDocument();
    const artifact = vi.mocked(bridge.exportHtml).mock.calls[0][0];
    expect(new TextDecoder().decode(artifact.bytes)).toContain("Export me");
    expect(new TextDecoder().decode(artifact.bytes)).toContain("Content-Security-Policy");
    expect(bridge.saveDocument).not.toHaveBeenCalled();
    expect(demo.editor.getDocument()).toBe("# Export me\n\nBody");
  });

  it("keeps disk-save success distinct from history failure", async () => {
    const { demo, bridge, control, root, saveResult } = await setup();
    await demo.openDocument(); demo.editor.setDocument("saved despite history failure");
    control<HTMLInputElement>("显式启用保存历史").checked = true;
    vi.mocked(bridge.saveDocument).mockImplementationOnce(async (request) => ({ ...saveResult(request), historyWarning: "history quota reached" }));
    await demo.save();
    expect(root.querySelector("[role='status']")?.textContent).toContain("history quota reached");
    expect(demo.getState()).toMatchObject({ dirty: false, version: "saved-v2" });
  });

  it("cancels the close handshake without destroying dirty content", async () => {
    let shutdown: (() => void) | undefined;
    const complete = vi.fn(async () => ({ ok: true as const }));
    Object.defineProperty(window, "nexusHost", { configurable: true, value: {
      mode: "runtime", onShutdown: (callback: () => void) => { shutdown = callback; return () => undefined; }, shutdownComplete: complete,
    } });
    const { demo, bridge, confirm } = await setup();
    demo.editor.setDocument("keep this dirty buffer"); confirm.mockReturnValue(false);
    shutdown?.();
    await vi.waitFor(() => expect(bridge.cancelShutdown).toHaveBeenCalled());
    expect(complete).not.toHaveBeenCalled();
    expect(demo.editor.getDocument()).toBe("keep this dirty buffer");
  });
});
