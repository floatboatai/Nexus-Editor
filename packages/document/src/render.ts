import type {
  DocumentDiagnostic,
  DocumentRenderContext,
  DocumentRenderHandle,
  DocumentRenderInput,
  RenderDocumentOptions,
} from "./types";
import { abortable, checkBytes, limits, operationSignal, throwIfAborted } from "./limits";
import {
  prepareStaticDocument,
  resolveStaticDomImages,
  resolveStaticStyles,
  staticAssets,
  type PreparedStaticDocument,
} from "./static-pipeline";

export type { DocumentRenderHandle, DocumentRenderExtension, RenderDocumentOptions } from "./types";

/**
 * Detached output belongs to the supplied Document. Trusted DOM hooks must use
 * data-resource-src rather than assigning network src/srcset values themselves.
 * Hooks can access DOM/fetch directly: this callback surface is not a sandbox.
 */
export function renderDocument(
  input: DocumentRenderInput,
  options: RenderDocumentOptions,
): DocumentRenderHandle {
  const element = options.document.createElement("article");
  const diagnostics: DocumentDiagnostic[] = [];
  const operation = operationSignal(options.signal, limits(options.limits).timeoutMs);
  const assets = staticAssets(options);
  let prepared: PreparedStaticDocument | undefined;
  let disposal: Promise<void> | null = null;
  const ready = (async () => {
    try {
      prepared = await prepareStaticDocument(input, { ...options, signal: operation.signal }, assets);
      diagnostics.push(...prepared.context.diagnostics);
      throwIfAborted(operation.signal);
      element.innerHTML = prepared.markup;
      const context: DocumentRenderContext = { ...prepared.context, document: options.document, diagnostics };
      for (const extension of options.extensions ?? []) {
        if (extension.render) {
          await abortable(Promise.resolve(extension.render(element, context)), operation.signal);
        }
        throwIfAborted(operation.signal);
        await resolveStaticDomImages(element, { ...options, signal: operation.signal }, assets, diagnostics);
      }
      const css = await resolveStaticStyles({ ...options, signal: operation.signal }, assets);
      if (css) {
        const style = options.document.createElement("style");
        style.textContent = css;
        element.prepend(style);
      }
      element.querySelectorAll("input").forEach((input) => {
        input.disabled = true;
      });
      checkBytes(element.outerHTML, limits(options.limits).maxOutputBytes, "Rendered document");
      prepared.finish();
    } catch (error) {
      await prepared?.dispose();
      element.remove();
      throw error;
    } finally {
      operation.dispose();
    }
  })();
  return {
    element,
    ready,
    diagnostics,
    dispose() {
      if (disposal) return disposal;
      operation.abort();
      disposal = (async () => {
        await ready.catch(() => undefined);
        try {
          await prepared?.dispose();
        } finally {
          element.remove();
        }
      })();
      return disposal;
    },
  };
}
