import type { Root } from "mdast";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import type { NexusPlugin } from "./types";

/**
 * Options shared by {@link createHtmlRenderer} and {@link renderMarkdownToHtml}.
 */
export interface HtmlRendererOptions {
  /**
   * Plugins whose `remarkPlugins` take part in the render pipeline. Pass the
   * same list you give `createEditor()` so server-rendered HTML matches what
   * `editor.exportHTML()` produces in the browser.
   */
  plugins?: NexusPlugin[];
  /**
   * Optional mdast transform applied after all remark plugins and before the
   * tree is converted to HTML. The editor uses this hook to apply dynamic
   * (runtime-contributed) transforms; hosts can use it to inject their own.
   */
  transform?: (tree: Root) => Root;
}

/**
 * A reusable Markdown → HTML pipeline. Build it once and call `render()` for
 * every document — the unified processor is resolved and frozen a single time,
 * which matters when a static-site build renders hundreds of pages.
 */
export interface HtmlRenderer {
  render(markdown: string): string;
}

/**
 * Create a DOM-free Markdown → HTML renderer.
 *
 * It runs the exact pipeline behind `editor.exportHTML()` (remark-parse →
 * plugin remark transforms → remark-rehype → rehype-stringify) but does not
 * need a CodeMirror view, a container element, or a `document` global, so it
 * can be used in Node.js for server-side rendering (SSR), static-site
 * generation (SSG), CLIs and build scripts.
 *
 * Raw HTML nodes in the source are dropped (remark-rehype default), so the
 * output is safe to embed without an extra sanitizer.
 */
export function createHtmlRenderer(options: HtmlRendererOptions = {}): HtmlRenderer {
  const { plugins = [], transform } = options;
  const processor = unified().use(remarkParse);
  for (const plugin of plugins) {
    for (const remarkPlugin of plugin.remarkPlugins ?? []) {
      processor.use(remarkPlugin);
    }
  }
  if (transform) {
    processor.use(() => (tree) => transform(tree as Root));
  }
  processor.use(remarkRehype).use(rehypeStringify);
  processor.freeze();

  return {
    render(markdown) {
      return String(processor.processSync(markdown));
    },
  };
}

/**
 * One-shot convenience wrapper around {@link createHtmlRenderer}. Prefer the
 * factory when rendering many documents with the same plugin set.
 */
export function renderMarkdownToHtml(markdown: string, options?: HtmlRendererOptions): string {
  return createHtmlRenderer(options).render(markdown);
}
