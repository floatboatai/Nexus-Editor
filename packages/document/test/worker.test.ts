// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "tsup";
import { zipSync, strToU8 } from "fflate";
import { convertDocx } from "@floatboat/nexus-document/docx";
import { extractPdfText } from "@floatboat/nexus-document/pdf-text";
import { createNodeConversionExecutor } from "@floatboat/nexus-document/node-worker";
import type { ConversionExecutor } from "@floatboat/nexus-document";
import { docxFixture, pdfFixture, png } from "./fixtures";

const executors: ConversionExecutor[] = [];
let workerRoot: string | null = null;
let preparedWorker: URL | null = null;
beforeAll(async () => {
  workerRoot = await mkdtemp(path.join(tmpdir(), "nexus-document-worker-test-"));
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as {
    dependencies: Record<string, string>; peerDependencies: Record<string, string>;
  };
  await symlink(path.join(packageRoot, "node_modules"), path.join(workerRoot, "node_modules"), "dir");
  await build({
    config: false, entry: [path.join(packageRoot, "src/worker-node.ts")], outDir: workerRoot,
    format: ["esm"], platform: "node", target: "node22", splitting: false, dts: false, clean: false, silent: true,
    outExtension: () => ({ js: ".mjs" }),
    tsconfig: path.join(packageRoot, "tsconfig.json"),
    external: [...Object.keys(manifest.dependencies), ...Object.keys(manifest.peerDependencies)],
  });
  preparedWorker = pathToFileURL(path.join(workerRoot, "worker-node.mjs"));
}, 15_000);
afterEach(async () => { await Promise.all(executors.splice(0).map((executor) => executor.dispose())); });
afterAll(async () => { if (workerRoot) await rm(workerRoot, { recursive: true, force: true }); });
function executor(workerUrl?: URL) {
  const selected = workerUrl ?? preparedWorker;
  if (!selected) throw new Error("Worker fixture was not prepared");
  const value = createNodeConversionExecutor({ workerUrl: selected });
  executors.push(value);
  return value;
}

describe("real isolated document conversions", () => {
  it("converts actual DOCX headings, bold text and embedded image bytes", async () => {
    const bytes = docxFixture();
    const result = await convertDocx(bytes, { executor: executor() });
    expect(result.markdown).toContain("# 中文 DOCX");
    expect(result.markdown).toContain("**Bold text**");
    expect(result.assetPlan).toHaveLength(1);
    expect(result.assetPlan[0].resource?.bytes).toEqual(png);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("rejects ZIP expansion limits and traversal entries", async () => {
    const worker = executor();
    await expect(convertDocx(docxFixture(), { executor: worker, limits: { maxArchiveBytes: 100 } })).rejects.toThrow(/ZIP|budget|large/);
    const bad = zipSync({ "../outside": strToU8("unsafe"), "word/document.xml": strToU8("<root/>") });
    await expect(convertDocx(bad, { executor: worker })).rejects.toThrow("unsafe");
  });

  it("does not let Mammoth recover an image budget failure as a successful conversion", async () => {
    await expect(convertDocx(docxFixture(), { executor: executor(), limits: { maxAssetBytes: 8 } })).rejects.toMatchObject({
      code: "limit-exceeded",
    });
  });

  it("extracts actual PDF pages and reports pages without text", async () => {
    const result = await extractPdfText(pdfFixture(["Hello PDF", null, "Second text page"]), { executor: executor() });
    expect(result.markdown).toContain("Hello PDF");
    expect(result.markdown).toContain("Page 3");
    expect(result.markdown).toContain("Second text page");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "no-text-layer", page: 2 }));
  });

  it("rejects all-scanned PDFs and page/output budgets without empty success", async () => {
    const worker = executor();
    await expect(extractPdfText(pdfFixture([null]), { executor: worker })).rejects.toMatchObject({ code: "no-text-layer" });
    await expect(extractPdfText(pdfFixture(["a", "b"]), { executor: worker, limits: { maxPages: 1 } })).rejects.toThrow("page budget");
    await expect(extractPdfText(pdfFixture(["This text is too long"]), { executor: worker, limits: { maxOutputBytes: 8 } })).rejects.toThrow("output budget");
  });

  it("terminates hung workers on abort and timeout, without transferring caller bytes", async () => {
    const worker = executor(new URL("data:text/javascript,while(true){}"));
    const bytes = docxFixture(false);
    const controller = new AbortController();
    const aborted = convertDocx(bytes, { executor: worker, signal: controller.signal });
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    expect(bytes.byteLength).toBeGreaterThan(0);
    await expect(convertDocx(bytes, { executor: worker, limits: { timeoutMs: 30 } })).rejects.toThrow("timed out");
    await worker.dispose();
    await expect(convertDocx(bytes, { executor: worker })).rejects.toThrow("disposed");
  });

  it("dispose cancels every owned task", async () => {
    const worker = executor(new URL("data:text/javascript,while(true){}"));
    const first = convertDocx(docxFixture(false), { executor: worker });
    const second = extractPdfText(pdfFixture(["x"]), { executor: worker });
    const results = Promise.allSettled([first, second]);
    await expect(convertDocx(docxFixture(false), { executor: worker })).rejects.toThrow("concurrency limit");
    await worker.dispose();
    expect(await results).toEqual([
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ name: "AbortError" }) }),
      expect.objectContaining({ status: "rejected", reason: expect.objectContaining({ name: "AbortError" }) }),
    ]);
  });
});
