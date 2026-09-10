import { convertDocx } from "../src/docx";
import { extractPdfText } from "../src/pdf-text";
import { createBrowserConversionExecutor } from "../src/browser-worker";
import { createConversionAssetProvider } from "../src/memory-assets";
import { exportHtml } from "../src/export-html";
import { createMathRenderExtension } from "../src/math";
import { createMermaidRenderExtension } from "../src/mermaid";
import { docxFixture, pdfFixture, png } from "../test/fixtures";

const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
let stage = "DOCX";

async function run() {
  const executor = createBrowserConversionExecutor(() => new Worker("./worker-browser.js", { type: "module" }));
  try {
    const docx = await convertDocx(docxFixture(), { executor });
    check(docx.markdown.includes("中文 DOCX") && docx.markdown.includes("**Bold text**"), "Browser DOCX text conversion failed");
    check(docx.assetPlan[0]?.resource?.bytes.length === png.length, "Browser DOCX image conversion failed");
    const html = await exportHtml(docx.markdown, { assetProvider: createConversionAssetProvider(docx) });
    check(html.html.includes("data:image/png;base64,") && !html.html.includes("nexus-asset:"), "Browser attachment export failed");
    stage = "PDF";
    const pdf = await extractPdfText(pdfFixture(["Browser PDF text", null]), { executor });
    check(pdf.markdown.includes("Browser PDF text"), "Browser PDF text extraction failed");
    check(pdf.diagnostics.some((item) => item.code === "no-text-layer" && item.page === 2), "Browser blank PDF page was not diagnosed");
    stage = "math";
    const math = await exportHtml("$x^2$", { extensions: [createMathRenderExtension()] });
    check(math.html.includes("<math"), "Browser math rendering failed");
    stage = "mermaid";
    const diagram = await exportHtml("```mermaid\ngraph TD; A-->B\n```", { document, extensions: [createMermaidRenderExtension()] });
    check(diagram.html.includes("<svg") && diagram.diagnostics.length === 0, "Real Mermaid rendering failed");
    const controller = new AbortController();
    const canceled = convertDocx(docxFixture(), { executor, signal: controller.signal });
    controller.abort();
    let aborted = false;
    try { await canceled; } catch (error) { aborted = error instanceof DOMException && error.name === "AbortError"; }
    check(aborted, "Browser worker cancellation failed");
    return { ok: true, docxImages: docx.assetPlan.length, pdfPages: 2, math: true, mermaid: true, cancellation: true };
  } finally { await executor.dispose(); }
}

(window as unknown as { documentSmoke: Promise<unknown> }).documentSmoke = run().catch((error: unknown) => ({
  ok: false, stage, error: error instanceof Error ? error.message : String(error),
}));
