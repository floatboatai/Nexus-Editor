import type { MarkdownPostProcessorRegistry, MarkdownRenderHandle } from "@floatboat/nexus-plugin-runtime";
import type { VaultPath } from "@floatboat/nexus-plugin-api";
import type { DocumentRenderExtension } from "./types";
import { abortable } from "./limits";

/** Adapts existing registrations and their lifecycle instead of creating a second registry. */
export function createRuntimeRenderExtension(registry: Pick<MarkdownPostProcessorRegistry, "renderFragment" | "renderCodeBlock">): DocumentRenderExtension {
  return {
    async render(element, context) {
      const source = {
        documentId: context.documentId,
        sourcePath: context.sourcePath as VaultPath | undefined,
        getSectionInfo(node: HTMLElement) {
          const section = node.closest<HTMLElement>("[data-source-start]");
          if (!section) return null;
          return {
            sourceStart: Number(section.dataset.sourceStart), sourceEnd: Number(section.dataset.sourceEnd),
            lineStart: Number(section.dataset.lineStart), lineEnd: Number(section.dataset.lineEnd),
          };
        },
      };
      const settle = async (handle: MarkdownRenderHandle) => {
        context.addCleanup(() => handle.invalidate());
        const result = await abortable(handle.ready, context.signal);
        if (result.status === "stale") throw new DOMException("Static render became stale", "AbortError");
      };
      await settle(registry.renderFragment({ element, ...source }));
      for (const code of Array.from(element.querySelectorAll<HTMLElement>("pre > code"))) {
        const block = code.parentElement;
        if (!block) continue;
        const language = Array.from(code.classList).find((name) => name.startsWith("language-"))?.slice(9) ?? "";
        const fallback = code.cloneNode(true);
        await settle(registry.renderCodeBlock({
          element: block, source: code.textContent ?? "", language, ...source,
          renderDefault(target) { target.replaceChildren(fallback.cloneNode(true)); },
        }));
      }
    },
  };
}
