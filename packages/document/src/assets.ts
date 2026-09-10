import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { unified, type Data } from "unified";
import type { Nodes } from "mdast";

export { createConversionAssetProvider } from "./memory-assets";
export type { AssetPlanEntry, AssetProvider, AssetResource } from "./types";

type MarkdownExtension = Exclude<NonNullable<Data["fromMarkdownExtensions"]>[number], unknown[]>;
type DestinationHandler = NonNullable<MarkdownExtension["exit"]>[string];

interface SourceEdit {
  readonly from: number;
  readonly to: number;
  readonly text: string;
}

/** Frontmatter is metadata, even when a quoted value happens to contain Markdown syntax. */
function protectedPrefixLength(markdown: string): number {
  const bom = markdown.startsWith("\ufeff") ? 1 : 0;
  const lines = markdown.slice(bom).matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g);
  const first = lines.next().value;
  const marker = first?.[0].trimEnd();
  if (marker !== "---" && marker !== "+++") return bom;
  for (const line of lines) {
    const value = line[0].trimEnd();
    if (value === marker || (marker === "---" && value === "...")) {
      return bom + (line.index ?? 0) + line[0].length;
    }
  }
  return bom;
}

function committedDestination(url: string, destinations: Readonly<Record<string, string>>): string {
  const destination = Object.hasOwn(destinations, url) ? destinations[url] : undefined;
  if (typeof destination !== "string" || !destination ||
    /^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(destination.trimStart()) || destination.includes("\0")) {
    throw new Error("Every logical attachment must map to a relative committed destination");
  }
  // Keep existing percent escapes. Escape Markdown syntax and entity-looking
  // ampersands without changing any surrounding angle brackets or title quotes.
  return destination.replace(/&/g, "&amp;").replace(/[\s()<>\\|]/g, (character) =>
    character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character));
}

/** Rewrite parser-confirmed URL spans only, after the host commits all attachments. */
export function rewriteAssetReferences(markdown: string, destinations: Readonly<Record<string, string>>): string {
  const prefix = protectedPrefixLength(markdown);
  const edits: SourceEdit[] = [];
  const captureDestination: DestinationHandler = function (token) {
    // These are the normal from-markdown destination handlers' buffer/URL
    // semantics. Token positions also preserve escapes, entities and titles.
    const url = this.resume();
    const node = this.stack[this.stack.length - 1];
    if (node.type !== "image" && node.type !== "link" && node.type !== "definition") {
      throw new Error("Unexpected Markdown destination context");
    }
    node.url = url;
    if (url.startsWith("nexus-asset:")) edits.push({
      from: prefix + token.start.offset,
      to: prefix + token.end.offset,
      text: committedDestination(url, destinations),
    });
  };
  const processor = unified().use(remarkParse).use(remarkGfm);
  processor.data("fromMarkdownExtensions", [{
    exit: {
      resourceDestinationString: captureDestination,
      definitionDestinationString: captureDestination,
    },
  }]);
  const tree = processor.parse(markdown.slice(prefix));
  const visit = (node: Nodes): void => {
    if (node.type === "link" && node.url.startsWith("nexus-asset:")) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      // A relative URL cannot remain an autolink. Change only this resource
      // element into an explicit link, preserving its original visible text.
      if (start !== undefined && end !== undefined &&
        markdown.slice(prefix + start, prefix + end) === `<${node.url}>`) {
        const label = node.url.replace(/[\\[\]`*_!]/g, "\\$&").replace(/&/g, "&amp;");
        edits.push({ from: prefix + start, to: prefix + end, text: `[${label}](${committedDestination(node.url, destinations)})` });
      }
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(tree);
  let output = markdown;
  let boundary = markdown.length;
  for (const edit of edits.sort((left, right) => right.from - left.from)) {
    if (edit.from < prefix || edit.to > boundary || edit.from > edit.to) {
      throw new Error("Overlapping or invalid Markdown resource positions");
    }
    output = output.slice(0, edit.from) + edit.text + output.slice(edit.to);
    boundary = edit.from;
  }
  return output;
}
