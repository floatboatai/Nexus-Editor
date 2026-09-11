import type { DocumentRenderHandle, DocumentRenderInput, HtmlArtifact, RenderDocumentOptions } from "./types";
import { checkBytes, limits, operationSignal, throwIfAborted } from "./limits";
import {
  offlineTree,
  parseHtmlFragment,
  prepareStaticDocument,
  resolveStaticStyles,
  serializeTree,
  shareStaticAssets,
  staticAssets,
  type PreparedStaticDocument,
} from "./static-pipeline";
import { renderDocument } from "./render";

export interface ExportHtmlOptions extends Omit<RenderDocumentOptions, "document"> {
  /** Required only when an explicitly enabled extension needs DOM layout. */
  readonly document?: Document;
  readonly language?: string;
}

function escape(value: string): string {
  const entities: Readonly<Record<string, string>> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => entities[character] ?? character);
}

/** Produces bytes, never a download or file write; the host owns persistence. */
export async function exportHtml(
  input: DocumentRenderInput,
  options: ExportHtmlOptions = {},
): Promise<HtmlArtifact> {
  const needsDom = options.extensions?.some((extension) => extension.render);
  if (needsDom && !options.document) throw new TypeError("A Document is required by the selected DOM render extension");
  const operation = operationSignal(options.signal, limits(options.limits).timeoutMs);
  const scoped = { ...options, signal: operation.signal };
  const assets = staticAssets(scoped);
  let rendered: DocumentRenderHandle | null = null;
  let prepared: PreparedStaticDocument | null = null;
  try {
    if (options.document) {
      rendered = renderDocument(input, shareStaticAssets({ ...scoped, document: options.document, styles: [] }, assets));
    } else {
      prepared = await prepareStaticDocument(input, scoped, assets);
    }
    if (rendered) await rendered.ready;
    const tree = rendered ? parseHtmlFragment(rendered.element.innerHTML) : prepared?.html;
    if (!tree) throw new Error("Document preparation returned no HTML tree");
    const css = await resolveStaticStyles(scoped, assets);
    throwIfAborted(operation.signal);
    const body = serializeTree(offlineTree(tree));
    const csp = "default-src 'none'; script-src 'none'; img-src data:; font-src data:; " +
      "style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'";
    const html = `<!doctype html><html lang="${escape(options.language ?? "en")}"><head>` +
      `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<title>${escape(options.title ?? "Document")}</title>${css ? `<style>${css}</style>` : ""}` +
      `</head><body><article>${body}</article></body></html>`;
    const bytes = new TextEncoder().encode(html);
    checkBytes(bytes, limits(options.limits).maxOutputBytes, "Offline HTML");
    return { html, bytes, diagnostics: [...(rendered?.diagnostics ?? prepared?.context.diagnostics ?? [])] };
  } finally {
    try {
      await rendered?.dispose();
      await prepared?.dispose();
    } finally {
      operation.dispose();
    }
  }
}
