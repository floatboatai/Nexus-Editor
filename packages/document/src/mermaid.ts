import createDOMPurify from "dompurify";
import type { DocumentRenderExtension } from "./types";
import { abortable, throwIfAborted } from "./limits";

export interface MermaidRenderOptions {
  readonly render?: (source: string, target: HTMLElement, signal: AbortSignal) => Promise<string>;
}

let renderTail: Promise<void> = Promise.resolve();

export function createMermaidRenderExtension(options: MermaidRenderOptions = {}): DocumentRenderExtension {
  return {
    async render(element, context) {
      for (const code of Array.from(element.querySelectorAll<HTMLElement>("pre > code.language-mermaid"))) {
        throwIfAborted(context.signal);
        const host = context.document.createElement("div");
        host.style.cssText = "position:fixed;left:-100000px;visibility:hidden;pointer-events:none";
        context.document.body.append(host);
        context.addCleanup(() => host.remove());
        try {
          const source = code.textContent ?? "";
          const work = renderTail.then(async () => {
            throwIfAborted(context.signal);
            if (options.render) return options.render(source, host, context.signal);
            const mermaid = (await import("mermaid")).default;
            mermaid.initialize({ startOnLoad: false, securityLevel: "strict", flowchart: { htmlLabels: false } });
            return (await mermaid.render(`nexus-document-${crypto.randomUUID()}`, source, host)).svg;
          });
          renderTail = work.then(() => undefined, () => undefined);
          const svg = await abortable(work, context.signal);
          throwIfAborted(context.signal);
          const ownerWindow = context.document.defaultView;
          if (!ownerWindow) throw new Error("Mermaid SVG sanitization requires a Document with its own Window");
          const purifier = createDOMPurify(ownerWindow);
          const target = context.document.createElement("div");
          target.innerHTML = purifier.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["style"], FORBID_TAGS: ["foreignObject"] });
          for (const style of Array.from(target.querySelectorAll("style"))) {
            const css = style.textContent ?? "";
            if (/@import|@font-face|expression\s*\(|\\/i.test(css) || Array.from(css.matchAll(/url\(([^)]*)\)/gi)).some((match) => !/^\s*["']?#[\w-]+["']?\s*$/.test(match[1]))) style.remove();
          }
          for (const node of Array.from(target.querySelectorAll("*"))) for (const attribute of Array.from(node.attributes)) {
            if ((["href", "xlink:href"].includes(attribute.name) && !attribute.value.startsWith("#")) || /url\s*\(/i.test(attribute.value) && !/^url\(#[\w-]+\)$/.test(attribute.value)) node.removeAttribute(attribute.name);
          }
          code.parentElement?.replaceWith(target);
        } catch (error) {
          throwIfAborted(context.signal);
          context.diagnostics.push({ code: "unsupported-content", message: "Mermaid rendering failed; source was preserved" });
        } finally { host.remove(); }
      }
    },
  };
}
