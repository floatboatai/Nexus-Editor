import katex from "katex";
import remarkMath from "remark-math";
import type { Element, Root, RootContent } from "hast";
import type { DocumentRenderExtension } from "./types";
import { parseHtmlFragment } from "./static-pipeline";

/** Native MathML is self-contained: no implicit stylesheet or font download. */
export function createMathRenderExtension(): DocumentRenderExtension {
  return {
    remarkPlugins: [remarkMath],
    transformHtml(tree, context) {
      const visit = (parent: Root | Element): void => {
        parent.children = parent.children.flatMap((node): RootContent[] => {
          if (node.type !== "element") return [node];
          const code = node.tagName === "pre" && node.children[0]?.type === "element" ? node.children[0] : node;
          const classes = Array.isArray(code.properties.className) ? code.properties.className : [];
          if (code.tagName === "code" && classes.includes("language-math")) {
            const source = code.children.map((child) => child.type === "text" ? child.value : "").join("");
            try {
              return parseHtmlFragment(katex.renderToString(source, {
                output: "mathml", displayMode: node.tagName === "pre", trust: false, throwOnError: true,
              })).children;
            } catch {
              context.diagnostics.push({ code: "unsupported-content", message: "Invalid math was preserved as source" });
              return [node];
            }
          }
          visit(node);
          return [node];
        });
      };
      visit(tree);
    },
  };
}
