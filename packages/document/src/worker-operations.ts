import { Unzip, UnzipInflate } from "fflate";
import { unified } from "unified";
import remarkStringify from "remark-stringify";
import type { Root } from "mdast";
import { convertHtml } from "./html";
import { checkBytes, DocumentLimitError, limits } from "./limits";
import type { AssetPlanEntry, ConversionRequest, ConversionResult, DocumentDiagnostic, DocumentLimits } from "./types";

function checkArchive(bytes: Uint8Array, budget: Required<DocumentLimits>): void {
  let total = 0;
  let entries = 0;
  let failure: Error | null = null;
  const names = new Set<string>();
  const unzip = new Unzip((file) => {
    if (++entries > budget.maxArchiveEntries) throw new DocumentLimitError("DOCX contains too many ZIP entries");
    if (/^(?:\/|\\|[a-z]:)/i.test(file.name) || file.name.split(/[\\/]/).includes("..") || names.has(file.name)) {
      throw new Error("DOCX contains an unsafe or duplicate ZIP entry");
    }
    names.add(file.name);
    if (file.originalSize !== undefined && file.originalSize > budget.maxArchiveBytes) throw new DocumentLimitError("DOCX ZIP entry is too large");
    file.ondata = (error, data) => {
      if (error) { failure = error; return; }
      total += data.length;
      if (total > budget.maxArchiveBytes || total > Math.max(bytes.length, 1) * budget.maxCompressionRatio) {
        file.terminate();
        throw new DocumentLimitError("DOCX expanded ZIP exceeds its byte or compression-ratio budget");
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  // Bound each inflation call, not just the ZIP's untrusted declared size.
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
    if (failure) throw failure;
  }
  if (!names.has("word/document.xml")) throw new Error("DOCX has no word/document.xml");
}

async function docx(request: ConversionRequest): Promise<ConversionResult> {
  const budget = limits(request.limits);
  checkArchive(request.bytes, budget);
  const mammoth = await import("mammoth");
  const assetPlan: AssetPlanEntry[] = [];
  let total = 0;
  const input = typeof Buffer === "function"
    ? { buffer: Buffer.from(request.bytes) }
    : { arrayBuffer: Uint8Array.from(request.bytes).buffer };
  const result = await mammoth.convertToHtml(input, {
    externalFileAccess: false,
    includeEmbeddedStyleMap: false,
    convertImage: mammoth.images.imgElement(async (image) => {
      const encoded = await image.readAsBase64String();
      const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
      checkBytes(bytes, budget.maxAssetBytes, "DOCX image");
      total += bytes.length;
      if (total > budget.maxTotalAssetBytes) throw new DocumentLimitError("DOCX images exceed total budget");
      const source = `embedded-image-${assetPlan.length + 1}`;
      assetPlan.push({ source, suggestedName: source, resource: { bytes, mimeType: image.contentType } });
      return { src: source };
    }),
  });
  // Mammoth recovers image callback failures into diagnostics. Capacity limits
  // must remain fatal rather than silently returning a document without images.
  for (const message of result.messages) {
    if (message.type === "error" && message.error instanceof DocumentLimitError) throw message.error;
  }
  checkBytes(result.value, budget.maxOutputBytes, "DOCX intermediate HTML");
  const converted = await convertHtml(result.value, {
    limits: { ...request.limits, maxInputBytes: budget.maxOutputBytes },
    assetProvider: { async read(source) { return assetPlan.find((asset) => asset.source === source)?.resource ?? null; } },
  });
  return { ...converted, diagnostics: [
    ...converted.diagnostics,
    ...result.messages.map((message) => ({ code: "conversion-warning" as const, message: message.message })),
  ] };
}

async function pdfText(request: ConversionRequest): Promise<ConversionResult> {
  const budget = limits(request.limits);
  const workerModule = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  Object.assign(globalThis, { pdfjsWorker: workerModule });
  const pdf = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdf.getDocument({
    data: Uint8Array.from(request.bytes),
    password: request.password,
    enableXfa: false,
    useWasm: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
  });
  const diagnostics: DocumentDiagnostic[] = [];
  try {
    const document = await loading.promise;
    if (document.numPages > budget.maxPages) throw new DocumentLimitError("PDF exceeds its page budget");
    const tree: Root = { type: "root", children: [] };
    let textBytes = 0;
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
        textBytes += new TextEncoder().encode(text).byteLength;
        if (textBytes > budget.maxOutputBytes) throw new DocumentLimitError("PDF text exceeds output budget");
        if (!text) { diagnostics.push({ code: "no-text-layer", message: "Page has no extractable text; OCR is not provided", page: number }); continue; }
        tree.children.push({ type: "heading", depth: 2, children: [{ type: "text", value: `Page ${number}` }] });
        tree.children.push({ type: "paragraph", children: [{ type: "text", value: text }] });
      } finally { page.cleanup(); }
    }
    if (!tree.children.length) throw Object.assign(new Error("PDF has no extractable text layer; OCR is not provided"), { code: "no-text-layer" });
    const markdown = unified().use(remarkStringify).stringify(tree);
    checkBytes(markdown, budget.maxOutputBytes, "PDF Markdown");
    return { markdown, assetPlan: [], diagnostics };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw Object.assign(new Error("PDF requires a valid password"), { code: "password-required" });
    }
    throw error;
  } finally { await loading.destroy(); }
}

export async function executeConversion(value: unknown): Promise<ConversionResult> {
  if (!value || typeof value !== "object") throw new TypeError("Invalid conversion request");
  const request = value as ConversionRequest;
  if (!(request.bytes instanceof Uint8Array) || (request.format !== "docx" && request.format !== "pdf-text")) throw new TypeError("Invalid conversion request");
  checkBytes(request.bytes, limits(request.limits).maxInputBytes, "Conversion input");
  return request.format === "docx" ? docx(request) : pdfText(request);
}
