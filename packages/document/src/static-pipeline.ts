import { scanWikiLinks } from "@floatboat/nexus-core";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Nodes, Parent, PhrasingContent, Root } from "mdast";
import type { Root as HtmlRoot, Element as HtmlElement } from "hast";

import type {
  AssetResource,
  DocumentDiagnostic,
  DocumentRenderInput,
  RenderDocumentOptions,
  StaticRenderContext,
} from "./types";
import { decodeImageDataUrl, imageMimeType } from "./html";
import {
  abortable,
  checkBytes,
  DocumentLimitError,
  limits,
  operationSignal,
  throwIfAborted,
} from "./limits";
import { canObserveWikiText, createWikiSourceMap } from "./wiki-source-map";

export type StaticOptions = Omit<RenderDocumentOptions, "document">;

const standardNodes = new Set([
  "root", "paragraph", "heading", "thematicBreak", "blockquote", "list", "listItem",
  "table", "tableRow", "tableCell", "code", "inlineCode", "text", "emphasis", "strong",
  "delete", "break", "link", "linkReference", "image", "imageReference", "definition",
  "footnoteDefinition", "footnoteReference", "html", "math", "inlineMath",
]);
const mathTags = [
  "math", "semantics", "annotation", "mrow", "mi", "mo", "mn", "mfrac", "msqrt",
  "mroot", "msub", "msup", "msubsup", "munder", "mover", "munderover", "mtable",
  "mtr", "mtd", "mtext", "mspace", "mstyle", "mpadded", "menclose", "mphantom",
];
const svgShapeTags = [
  "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text",
  "tspan", "defs", "marker", "clipPath", "linearGradient", "radialGradient", "stop",
];

function text(node: Nodes): string {
  if ("value" in node) return String(node.value);
  return "children" in node ? node.children.map(text).join("") : "";
}

function slug(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-") || "section";
}

export function walkHtml(parent: HtmlRoot | HtmlElement, visit: (element: HtmlElement) => void): void {
  for (const node of parent.children) {
    if (node.type !== "element") continue;
    visit(node);
    walkHtml(node, visit);
  }
}

export function sanitizeHtmlTree(tree: HtmlRoot): HtmlRoot {
  const cleanStyles = (parent: HtmlRoot | HtmlElement, inSvg = false): void => {
    parent.children = parent.children.filter((node) => {
      if (node.type !== "element") return true;
      if (inSvg || node.tagName === "svg") {
        for (const [name, value] of Object.entries(node.properties)) {
          if (typeof value === "string" && /url\s*\(/i.test(value) &&
            !/^url\(\s*['"]?#[\w-]+['"]?\s*\)$/i.test(value)) {
            delete node.properties[name];
          }
        }
      }
      if (node.tagName === "style") {
        const css = node.children.map((child) => child.type === "text" ? child.value : "").join("");
        return inSvg && !/@import|@font-face|expression\s*\(|\\|\b(?:image-set|image|src)\s*\(/i.test(css) &&
          !Array.from(css.matchAll(/url\(([^)]*)\)/gi)).some((match) => !/^\s*["']?#[\w-]+["']?\s*$/.test(match[1]));
      }
      cleanStyles(node, inSvg || node.tagName === "svg");
      return true;
    });
  };
  cleanStyles(tree);
  return unified().use(rehypeSanitize, {
    ...defaultSchema,
    clobberPrefix: "",
    tagNames: [
      ...(defaultSchema.tagNames ?? []), ...mathTags, "style", "svg", ...svgShapeTags, "title", "desc",
    ],
    attributes: {
      ...defaultSchema.attributes,
      "*": [
        ...(defaultSchema.attributes?.["*"] ?? []), "className", "id", "dataResourceSrc",
        "dataWikilinkTarget", "dataCrossFileLink", "dataSourceStart", "dataSourceEnd",
        "dataLineStart", "dataLineEnd",
      ],
      math: ["xmlns", "display"],
      annotation: ["encoding"],
      ...Object.fromEntries(mathTags
        .filter((name) => name !== "math" && name !== "annotation")
        .map((name) => [name, [
          "mathvariant", "displaystyle", "scriptlevel", "stretchy", "fence", "accent",
          "accentunder", "linethickness", "columnalign", "columnspacing", "rowspacing",
          "width", "height", "depth", "lspace", "rspace", "rowspan", "columnspan",
        ]])),
      svg: ["xmlns", "viewBox", "width", "height", "role", "ariaLabelledBy"],
      ...Object.fromEntries(svgShapeTags.map((name) => [name, [
        "id", "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
        "width", "height", "points", "transform", "fill", "stroke", "strokeWidth",
        "strokeDasharray", "textAnchor", "dominantBaseline", "markerStart", "markerEnd",
        "markerWidth", "markerHeight", "refX", "refY", "orient", "viewBox", "offset",
        "stopColor", "stopOpacity", "clipPath",
      ]])),
      img: ["src", "alt", "title", "width", "height", "dataResourceSrc"],
    },
    protocols: { ...defaultSchema.protocols, src: ["data"], href: ["https", "http", "mailto"] },
  }).runSync(tree) as HtmlRoot;
}

export function serializeTree(tree: HtmlRoot): string {
  return unified().use(rehypeStringify).stringify(tree);
}

export function parseHtmlFragment(html: string): HtmlRoot {
  return unified().use(rehypeParse, { fragment: true }).parse(html);
}

export function bytesDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Per-operation accounting shared by the Markdown, DOM and stylesheet phases. */
export interface StaticAssetContext {
  readonly budget: ReturnType<typeof limits>;
  readonly images: Map<string, string | null>;
  readonly styles: Map<string, string>;
  readonly embeddedImages: Set<string>;
  totalBytes: number;
}

const sharedAssets = new WeakMap<object, StaticAssetContext>();

export function staticAssets(options: StaticOptions): StaticAssetContext {
  return sharedAssets.get(options) ?? {
    budget: limits(options.limits),
    images: new Map(),
    styles: new Map(),
    embeddedImages: new Set(),
    totalBytes: 0,
  };
}

/** Internal bridge: export supplies one fresh options object to its DOM render phase. */
export function shareStaticAssets<T extends StaticOptions>(options: T, assets: StaticAssetContext): T {
  sharedAssets.set(options, assets);
  return options;
}

function countAsset(bytes: Uint8Array, assets: StaticAssetContext): void {
  checkBytes(bytes, assets.budget.maxAssetBytes, "Asset");
  assets.totalBytes += bytes.byteLength;
  if (assets.totalBytes > assets.budget.maxTotalAssetBytes) {
    throw new DocumentLimitError("Resources exceed total asset budget");
  }
}

export async function resolveStaticImage(
  source: string,
  options: StaticOptions,
  assets: StaticAssetContext,
): Promise<string | null> {
  throwIfAborted(options.signal);
  if (assets.embeddedImages.has(source)) return source;
  if (assets.images.has(source)) return assets.images.get(source) ?? null;
  let asset = /^data:/i.test(source) ? decodeImageDataUrl(source, assets.budget.maxAssetBytes) : null;
  if (!asset && !/^(?:data:|https?:|file:|blob:|\/|\\)/i.test(source)) {
    try {
      const work = options.assetProvider?.read(source, {
        signal: options.signal,
        sourcePath: options.sourcePath,
        documentId: options.documentId,
        maxBytes: assets.budget.maxAssetBytes,
      }) ?? Promise.resolve(null);
      asset = options.signal ? await abortable(work, options.signal) : await work;
    } catch (error) {
      throwIfAborted(options.signal);
      if (error instanceof DocumentLimitError) throw error;
    }
  }
  throwIfAborted(options.signal);
  let url: string | null = null;
  const mimeType = asset?.mimeType.trim().toLowerCase();
  if (asset && mimeType && imageMimeType.test(mimeType)) {
    countAsset(asset.bytes, assets);
    const bytes = mimeType === "image/svg+xml"
      ? new TextEncoder().encode(serializeTree(sanitizeHtmlTree(parseHtmlFragment(new TextDecoder().decode(asset.bytes)))))
      : asset.bytes;
    url = bytesDataUrl(bytes, mimeType);
    assets.embeddedImages.add(url);
  }
  assets.images.set(source, url);
  return url;
}

/** Re-resolve DOM additions without replacing nodes owned by runtime processors. */
export async function resolveStaticDomImages(
  element: HTMLElement,
  options: StaticOptions,
  assets: StaticAssetContext,
  diagnostics: DocumentDiagnostic[],
): Promise<void> {
  const images = Array.from(element.querySelectorAll("img"));
  const pending = images.flatMap((image) => {
    const source = image.getAttribute("data-resource-src") ?? image.getAttribute("src") ?? "";
    if (!image.hasAttribute("data-resource-src") && !image.hasAttribute("srcset") && assets.embeddedImages.has(source)) {
      return [];
    }
    if ((image.hasAttribute("src") && !assets.embeddedImages.has(image.getAttribute("src") ?? "")) ||
      image.hasAttribute("srcset")) {
      diagnostics.push({
        code: "unsafe-content",
        message: "A trusted DOM extension supplied an active image URL; use data-resource-src to defer loading until authorization",
        source,
      });
    }
    // Remove every active URL before awaiting any provider. This cannot undo a
    // request the trusted callback may already have started before returning.
    image.removeAttribute("src");
    image.removeAttribute("srcset");
    return [{ image, source }];
  });
  for (const { image, source } of pending) {
    const url = await resolveStaticImage(source, options, assets);
    throwIfAborted(options.signal);
    if (url) {
      image.setAttribute("src", url);
      image.removeAttribute("data-resource-src");
    } else {
      if (options.strictAssets) throw new Error("Document contains an unavailable image");
      diagnostics.push({ code: "asset-unavailable", message: "Image bytes unavailable or not authorized", source });
      const placeholder = image.ownerDocument.createElement("span");
      placeholder.textContent = `[Image unavailable${image.alt ? `: ${image.alt}` : ""}]`;
      image.replaceWith(placeholder);
    }
  }
}

function inlineFont(source: string, maximum: number): AssetResource | null {
  const match = /^data:(font\/(?:woff2?|ttf|otf));base64,([a-z0-9+/=\s]+)$/i.exec(source);
  if (!match) return null;
  if (match[2].length > Math.ceil(maximum * 4 / 3) + 8) {
    throw new DocumentLimitError("Inline font exceeds its bytes limit");
  }
  try {
    return {
      bytes: Uint8Array.from(atob(match[2]), (value) => value.charCodeAt(0)),
      mimeType: match[1].toLowerCase(),
    };
  } catch {
    return null;
  }
}

/** Styles are embedded before attaching a style node; unsupported resource syntax fails closed. */
export async function resolveStaticStyles(options: StaticOptions, assets: StaticAssetContext): Promise<string> {
  throwIfAborted(options.signal);
  let css = (options.styles ?? []).join("\n");
  if (/@import|expression\s*\(|\\|\b(?:image-set|image|src)\s*\(/i.test(css)) {
    throw new TypeError("Offline styles cannot contain imports, expressions, escaped URLs or unsupported resource functions");
  }
  const matches = Array.from(css.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi));
  if (Array.from(css.matchAll(/url\s*\(/gi)).length !== matches.length) {
    throw new TypeError("Unsupported stylesheet resource URL syntax");
  }
  for (const match of matches.reverse()) {
    const source = match[2].trim();
    if (/^#[\w-]+$/.test(source)) continue;
    let url = assets.styles.get(source) ?? assets.images.get(source) ?? undefined;
    if (!url) {
      if (/^data:image\//i.test(source)) {
        url = await resolveStaticImage(source, options, assets) ?? undefined;
      } else {
        if (!/^data:/i.test(source) && /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(source)) {
          throw new TypeError("Offline styles cannot load external resources");
        }
        const work = /^data:/i.test(source)
          ? Promise.resolve(inlineFont(source, assets.budget.maxAssetBytes))
          : options.assetProvider?.read(source, {
              signal: options.signal,
              sourcePath: options.sourcePath,
              documentId: options.documentId,
              maxBytes: assets.budget.maxAssetBytes,
            }) ?? Promise.resolve(null);
        const resource = options.signal ? await abortable(work, options.signal) : await work;
        throwIfAborted(options.signal);
        const mimeType = resource?.mimeType.trim().toLowerCase();
        if (resource && mimeType && /^(?:font\/(?:woff2?|ttf|otf)|image\/(?:png|jpeg|gif|webp|avif))$/.test(mimeType)) {
          countAsset(resource.bytes, assets);
          url = bytesDataUrl(resource.bytes, mimeType);
        }
      }
      if (!url) throw new Error("A stylesheet resource could not be embedded safely");
      assets.styles.set(source, url);
    }
    const replacement = `url("${url}")`;
    css = css.slice(0, match.index) + replacement + css.slice((match.index ?? 0) + match[0].length);
    checkBytes(css, assets.budget.maxOutputBytes, "Embedded styles");
  }
  throwIfAborted(options.signal);
  return css.replace(/</g, "\\3c ");
}

export interface PreparedStaticDocument {
  readonly html: HtmlRoot;
  readonly markup: string;
  readonly context: StaticRenderContext;
  dispose(): Promise<void>;
  finish(): void;
}

export async function prepareStaticDocument(
  input: DocumentRenderInput,
  options: StaticOptions,
  assets = staticAssets(options),
): Promise<PreparedStaticDocument> {
  const budget = limits(options.limits);
  const markdown = typeof input === "string" ? input : input.markdown;
  checkBytes(markdown, budget.maxInputBytes, "Markdown input");
  const operation = operationSignal(options.signal, budget.timeoutMs);
  const cleanups: Array<() => void | Promise<void>> = [];
  let disposal: Promise<void> | null = null;
  let disposed = false;
  const context: StaticRenderContext = {
    markdown,
    signal: operation.signal,
    documentId: options.documentId ?? "document",
    sourcePath: options.sourcePath,
    diagnostics: [],
    addCleanup(cleanup) {
      if (!disposed) {
        cleanups.push(cleanup);
      } else {
        void Promise.resolve().then(cleanup).catch(() => {
          context.diagnostics.push({ code: "conversion-warning", message: "Late render cleanup failed" });
        });
      }
    },
  };
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    operation.abort();
    operation.dispose();
    // Publish the promise before invoking callbacks, and keep draining work they
    // register while disposal is in progress. Late registrations after completion
    // are best-effort only: an uncooperative host callback is not a sandboxed task.
    disposal = Promise.resolve().then(async () => {
      const errors: unknown[] = [];
      while (cleanups.length) {
        const results = await Promise.allSettled(cleanups.splice(0).reverse().map(async (cleanup) => cleanup()));
        for (const result of results) {
          if (result.status === "rejected") errors.push(result.reason);
        }
      }
      disposed = true;
      if (errors.length) throw new AggregateError(errors, "Document render cleanup failed");
    });
    return disposal;
  };
  try {
    throwIfAborted(operation.signal);
    const parser = unified().use(remarkParse);
    for (const extension of options.extensions ?? []) {
      for (const plugin of extension.remarkPlugins ?? []) parser.use(plugin);
    }
    const wiki = scanWikiLinks(markdown);
    const positions = createWikiSourceMap();
    if (wiki.length) {
      parser.use(function captureSourcePositions() {
        const extensions = this.data("fromMarkdownExtensions") ?? [];
        if (!canObserveWikiText(extensions)) {
          context.diagnostics.push({
            code: "unsupported-content",
            message: "Wiki conversion was skipped to preserve a custom Markdown text compiler",
          });
          return;
        }
        this.data("fromMarkdownExtensions", [
          ...extensions,
          positions.extension,
        ]);
      });
    }
    let tree: Root;
    if (typeof input !== "string" && input.renderAst) {
      tree = structuredClone(input.renderAst);
      if (wiki.length) positions.capture(parser.parse(markdown));
    } else {
      const parsed = parser.parse(markdown);
      if (wiki.length) positions.capture(parsed);
      tree = parser.runSync(parsed, markdown) as Root;
    }
    const ids = new Set<string>();
    let nodeCount = 0;
    const visit = (node: Nodes, insideLink = false): void => {
      if (++nodeCount > budget.maxNodes) throw new DocumentLimitError("Markdown contains too many nodes");
      if (node.position) {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            dataSourceStart: node.position.start.offset,
            dataSourceEnd: node.position.end.offset,
            dataLineStart: node.position.start.line - 1,
            dataLineEnd: node.position.end.line - 1,
          },
        };
      }
      if (node.type === "heading") {
        const base = slug(text(node));
        let id = base;
        for (let index = 1; ids.has(id); index++) id = `${base}-${index}`;
        ids.add(id);
        node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
      }
      if (!("children" in node)) return;
      const withinLink = insideLink || node.type === "link" || node.type === "linkReference";
      const children: Parent["children"] = [];
      for (const child of node.children) {
        if (child.type === "html") {
          if (/^<br\s*\/?\s*>$/i.test(child.value)) {
            children.push({ type: "break" });
          } else {
            context.diagnostics.push({ code: "unsafe-content", message: "Raw HTML was omitted" });
          }
          continue;
        }
        if (!standardNodes.has(child.type)) {
          children.push({
            type: "text",
            value: child.position
              ? markdown.slice(child.position.start.offset, child.position.end.offset)
              : text(child),
          });
          context.diagnostics.push({
            code: "unsupported-content",
            message: `No static renderer for ${child.type}; source preserved`,
          });
          continue;
        }
        if (child.type === "text" && !withinLink && child.position) {
          const from = child.position.start.offset ?? -1;
          const to = child.position.end.offset ?? -1;
          let low = 0;
          let high = wiki.length;
          while (low < high) {
            const middle = (low + high) >>> 1;
            if (wiki[middle].from < from) low = middle + 1;
            else high = middle;
          }
          let offset = 0;
          let replaced = false;
          for (let index = low; index < wiki.length && wiki[index].to <= to; index += 1) {
            const match = wiki[index];
            const start = positions.offset(child, match.from);
            const end = positions.offset(child, match.to);
            if (start === undefined || end === undefined || start < offset) continue;
            children.push({ type: "text", value: child.value.slice(offset, start) });
            const hash = match.target.indexOf("#");
            const file = hash < 0 ? match.target : match.target.slice(0, hash);
            const heading = hash < 0 ? "" : match.target.slice(hash + 1);
            const resolved = file ? options.resolveWikilink?.(file, options.sourcePath) : options.sourcePath;
            const local = !file || Boolean(resolved && resolved === options.sourcePath);
            const link: PhrasingContent = {
              type: "link",
              url: local && heading ? `#${slug(heading)}` : "#",
              children: [{ type: "text", value: match.display }],
              data: {
                hProperties: {
                  dataWikilinkTarget: match.target,
                  ...(!local ? { dataCrossFileLink: true } : {}),
                },
              },
            };
            children.push(link);
            offset = end;
            replaced = true;
          }
          if (replaced) {
            children.push({ type: "text", value: child.value.slice(offset) });
            continue;
          }
        }
        visit(child, withinLink);
        children.push(child);
      }
      (node as Parent).children = children;
    };
    visit(tree);
    let html = unified().use(remarkRehype).runSync(tree, markdown) as HtmlRoot;
    // Make all resources inert before extensions or the browser see markup.
    walkHtml(html, (node) => {
      if (node.tagName === "img") {
        node.properties.dataResourceSrc = String(node.properties.src ?? "");
        delete node.properties.src;
        delete node.properties.srcSet;
      }
    });
    html = sanitizeHtmlTree(html);
    for (const extension of options.extensions ?? []) {
      throwIfAborted(operation.signal);
      if (extension.transformHtml) {
        await abortable(Promise.resolve(extension.transformHtml(html, context)), operation.signal);
      }
    }
    const images: HtmlElement[] = [];
    walkHtml(html, (node) => {
      if (node.tagName === "img") images.push(node);
    });
    for (const image of images) {
      throwIfAborted(operation.signal);
      const source = String(image.properties.dataResourceSrc ?? image.properties.src ?? "");
      const url = await resolveStaticImage(source, { ...options, signal: operation.signal }, assets);
      if (url) {
        image.properties.src = url;
        delete image.properties.dataResourceSrc;
      } else {
        if (options.strictAssets) throw new Error("Document contains an unavailable image");
        context.diagnostics.push({ code: "asset-unavailable", message: "Image bytes unavailable or not authorized", source });
        image.tagName = "span";
        image.children = [{
          type: "text",
          value: `[Image unavailable${image.properties.alt ? `: ${image.properties.alt}` : ""}]`,
        }];
        image.properties = {};
      }
    }
    html = sanitizeHtmlTree(html);
    throwIfAborted(operation.signal);
    const markup = serializeTree(html);
    checkBytes(markup, budget.maxOutputBytes, "Rendered HTML");
    return { html, markup, context, dispose, finish: () => operation.dispose() };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export function offlineTree(tree: HtmlRoot): HtmlRoot {
  walkHtml(tree, (node) => {
    if (node.tagName === "a" && (node.properties.dataCrossFileLink ||
      !/^(?:#|https?:|mailto:)/i.test(String(node.properties.href ?? "")))) {
      node.tagName = "span";
      node.properties = {};
    }
    for (const name of Object.keys(node.properties)) {
      if (name.startsWith("data") || ["contentEditable", "tabIndex", "srcSet"].includes(name)) {
        delete node.properties[name];
      }
      if (name === "src" && !/^data:image\//i.test(String(node.properties[name]))) {
        delete node.properties[name];
      }
      if (typeof node.properties[name] === "string" && /url\s*\(/i.test(String(node.properties[name])) &&
        !/^url\(#[\w-]+\)$/.test(String(node.properties[name]))) {
        delete node.properties[name];
      }
    }
    if (node.tagName === "input") node.properties.disabled = true;
  });
  return sanitizeHtmlTree(tree);
}
