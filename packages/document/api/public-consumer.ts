import { createConversionAssetProvider, type AssetProvider, type ConversionResult } from "@floatboat/nexus-document";
import { convertHtml } from "@floatboat/nexus-document/html";
import { convertCsv } from "@floatboat/nexus-document/csv";
import { convertDocx } from "@floatboat/nexus-document/docx";
import { extractPdfText } from "@floatboat/nexus-document/pdf-text";
import { createNodeConversionExecutor } from "@floatboat/nexus-document/node-worker";
import { createBrowserConversionExecutor } from "@floatboat/nexus-document/browser-worker";
import { renderDocument } from "@floatboat/nexus-document/render";
import { exportHtml } from "@floatboat/nexus-document/export-html";
import { rewriteAssetReferences } from "@floatboat/nexus-document/assets";
import { createGfmRenderExtension } from "@floatboat/nexus-document/gfm";
import { createMathRenderExtension } from "@floatboat/nexus-document/math";
import { createMermaidRenderExtension } from "@floatboat/nexus-document/mermaid";
import { createRuntimeRenderExtension } from "@floatboat/nexus-document/runtime";

export async function consume(ownerDocument: Document, bytes: Uint8Array, assets: AssetProvider) {
  const result: ConversionResult = await convertHtml("<h1>Example</h1>", { assetProvider: assets });
  const provider: AssetProvider = createConversionAssetProvider(result, assets);
  const rendering = renderDocument(result.markdown, { document: ownerDocument, assetProvider: provider, extensions: [createGfmRenderExtension(), createMathRenderExtension()] });
  await rendering.ready;
  await rendering.dispose();
  const html = await exportHtml(result.markdown, { assetProvider: provider });
  const executor = createNodeConversionExecutor();
  try { await convertDocx(bytes, { executor }); await extractPdfText(bytes, { executor }); }
  finally { await executor.dispose(); }
  return { bytes: html.bytes, markdown: rewriteAssetReferences(result.markdown, {}) };
}

void [convertCsv, createBrowserConversionExecutor, createMermaidRenderExtension, createRuntimeRenderExtension];
