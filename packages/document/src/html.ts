import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeRemark from "rehype-remark";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import type { Element, Root as HtmlRoot, RootContent } from "hast";
import type { Root } from "mdast";
import type { AssetPlanEntry, AssetResource, ConversionOptions, ConversionResult, DocumentDiagnostic } from "./types";
import { abortable, checkBytes, DocumentLimitError, limits, operationSignal, throwIfAborted } from "./limits";

export const imageMimeType = /^image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml)$/i;
const activeTags = new Set(["script", "style", "iframe", "object", "embed", "form", "base", "link", "meta", "template"]);

export function decodeImageDataUrl(source: string, maxBytes: number): AssetResource | null {
  const match = /^data:(image\/[^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(source);
  if (!match || !imageMimeType.test(match[1])) return null;
  if (match[2].length > Math.ceil(maxBytes * 4 / 3) + 8) throw new DocumentLimitError("Inline image exceeds its size limit");
  try {
    const bytes = Uint8Array.from(atob(match[2]), (value) => value.charCodeAt(0));
    checkBytes(bytes, maxBytes, "Inline image");
    return { bytes, mimeType: match[1].toLowerCase() };
  } catch (error) {
    if (error instanceof DocumentLimitError) throw error;
    return null;
  }
}

export async function convertHtml(html: string, options: ConversionOptions = {}): Promise<ConversionResult> {
  const budget = limits(options.limits);
  checkBytes(html, budget.maxInputBytes, "HTML input");
  const operation = operationSignal(options.signal, budget.timeoutMs);
  const diagnostics: DocumentDiagnostic[] = [];
  const assetPlan: AssetPlanEntry[] = [];
  const imageSources = new Map<string, string>();
  let assetBytes = 0;
  let nodes = 0;
  const namespace = encodeURIComponent(options.documentId ?? crypto.randomUUID());
  try {
    throwIfAborted(operation.signal);
    const parser = unified().use(rehypeParse, { fragment: true });
    const tree = parser.parse(html);
    const visit = async (parent: HtmlRoot | Element): Promise<void> => {
      const children: RootContent[] = [];
      for (const node of parent.children) {
        throwIfAborted(operation.signal);
        if (++nodes > budget.maxNodes) throw new DocumentLimitError("HTML contains too many nodes");
        if (node.type !== "element") { children.push(node); continue; }
        if (activeTags.has(node.tagName)) {
          diagnostics.push({ code: "unsafe-content", message: `Omitted active HTML element: ${node.tagName}` });
          continue;
        }
        if (node.tagName === "img") {
          const source = String(node.properties.src ?? "");
          let logical = imageSources.get(source);
          if (!logical) {
            logical = `nexus-asset:${namespace}/${assetPlan.length + 1}`;
            imageSources.set(source, logical);
            let resource: AssetResource | null = null;
            if (/^data:/i.test(source)) {
              resource = decodeImageDataUrl(source, budget.maxAssetBytes);
            } else if (source && !/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(source)) {
              try {
                resource = await abortable(options.assetProvider?.read(source, {
                  sourcePath: options.sourcePath,
                  documentId: options.documentId,
                  signal: operation.signal,
                  maxBytes: budget.maxAssetBytes,
                }) ?? Promise.resolve(null), operation.signal);
              } catch (error) {
                throwIfAborted(operation.signal);
                if (error instanceof DocumentLimitError) throw error;
              }
            }
            if (resource && !imageMimeType.test(resource.mimeType)) resource = null;
            if (resource) {
              checkBytes(resource.bytes, budget.maxAssetBytes, "Image");
              assetBytes += resource.bytes.byteLength;
              if (assetBytes > budget.maxTotalAssetBytes) throw new DocumentLimitError("Images exceed total asset budget");
              resource = { bytes: resource.bytes.slice(), mimeType: resource.mimeType };
            } else diagnostics.push({ code: "asset-unavailable", message: "Image bytes are unavailable or not authorized", source });
            const extension = resource?.mimeType === "image/svg+xml" ? "svg" : resource?.mimeType.split("/")[1] ?? "bin";
            assetPlan.push({ source: logical, suggestedName: `image-${assetPlan.length + 1}.${extension}`, resource, originalSource: source });
          }
          node.properties = { src: logical, alt: node.properties.alt ?? "" };
        }
        await visit(node);
        children.push(node);
      }
      parent.children = children;
    };
    await visit(tree);
    const converter = unified()
      .use(rehypeSanitize, {
        ...defaultSchema,
        protocols: { ...defaultSchema.protocols, src: ["nexus-asset"], href: ["https", "http", "mailto"] },
      })
      .use(rehypeRemark)
      .use(remarkGfm)
      .use(remarkStringify);
    const markdownTree = converter.runSync(tree, html) as Root;
    const markdown = converter.stringify(markdownTree);
    checkBytes(markdown, budget.maxOutputBytes, "Converted Markdown");
    throwIfAborted(operation.signal);
    return { markdown, assetPlan, diagnostics };
  } finally { operation.dispose(); }
}
