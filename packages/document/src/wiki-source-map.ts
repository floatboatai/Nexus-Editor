import type { Nodes, Root, Text } from "mdast";
import type { Data } from "unified";

type MarkdownExtension = Exclude<NonNullable<Data["fromMarkdownExtensions"]>[number], unknown[]>;
type Handler = NonNullable<MarkdownExtension["exit"]>[string];
type Token = Parameters<Handler>[0];

interface TextSegment {
  readonly sourceStart: number;
  readonly sourceEnd: number;
  readonly textStart: number;
  readonly textEnd: number;
}

interface SourceText {
  readonly value: string;
  readonly segments: readonly TextSegment[];
}

const textCompilerHooks = new Set([
  "data", "characterEscape", "characterEscapeValue", "characterReference",
  "characterReferenceValue", "characterReferenceMarkerHexadecimal",
  "characterReferenceMarkerNumeric", "lineEnding",
]);

/** Existing compiler hooks own their text semantics; never replace their handlers. */
export function canObserveWikiText(extensions: readonly unknown[]): boolean {
  return extensions.every((extension) => {
    if (Array.isArray(extension)) return canObserveWikiText(extension);
    if (!extension || typeof extension !== "object") return true;
    for (const [phase, handlers] of Object.entries(extension)) {
      if ((phase === "enter" || phase === "exit") && handlers && typeof handlers === "object" &&
        Object.keys(handlers).some((name) => textCompilerHooks.has(name))) {
        return false;
      }
    }
    return true;
  });
}

export interface WikiSourceMap {
  readonly extension: MarkdownExtension;
  capture(tree: Root): void;
  offset(node: Text, sourceOffset: number): number | undefined;
}

function point(value: Token["start"]): NonNullable<Text["position"]>["start"] {
  return { line: value.line, column: value.column, offset: value.offset };
}

function sourceKey(node: Text): string {
  return `${node.position?.start.offset}:${node.position?.end.offset}`;
}

/**
 * Observe the compiler's actual text chunks instead of reparsing each prefix.
 * Containers may omit source indentation, and entities/escapes have different
 * source and decoded widths. Keeping token boundaries handles both cases.
 */
export function createWikiSourceMap(): WikiSourceMap {
  const segments = new WeakMap<Text, TextSegment[]>();
  const compiledValues = new WeakMap<Text, string>();
  const references = new WeakMap<Text, number>();
  const sourceText = new Map<string, SourceText>();

  const append = (node: Text, token: Token, textStart: number): void => {
    const values = segments.get(node) ?? [];
    values.push({
      sourceStart: token.start.offset,
      sourceEnd: token.end.offset,
      textStart,
      textEnd: node.value.length,
    });
    segments.set(node, values);
    compiledValues.set(node, node.value);
  };

  // These mirror from-markdown's normal text exits. Character reference values
  // remain decoded by its own handler, including numeric replacement rules.
  const exitData: Handler = function (token) {
    const node = this.stack.pop();
    if (node?.type !== "text" || !node.position) {
      throw new Error("Expected a positioned Markdown text token");
    }
    const start = node.value.length;
    node.value += this.sliceSerialize(token);
    node.position.end = point(token.end);
    append(node, token, start);
  };

  const extension: MarkdownExtension = {
    enter: {
      characterReferenceValue() {
        const node = this.stack[this.stack.length - 1];
        if (node.type === "text") references.set(node, node.value.length);
      },
    },
    exit: {
      data: exitData,
      characterEscapeValue: exitData,
      characterReference(token) {
        const node = this.stack.pop();
        if (node?.type !== "text" || !node.position) {
          throw new Error("Expected a positioned Markdown character reference");
        }
        const start = references.get(node);
        if (start === undefined) throw new Error("Missing Markdown character reference start");
        node.position.end = point(token.end);
        append(node, token, start);
        references.delete(node);
      },
      lineEnding(token) {
        const parent = this.stack[this.stack.length - 1];
        if (this.data.atHardBreak) {
          if ("children" in parent) {
            const node = parent.children[parent.children.length - 1];
            if (node.position) node.position.end = point(token.end);
          }
          this.data.atHardBreak = undefined;
        } else if (!this.data.setextHeadingSlurpLineEnding && this.config.canContainEols.includes(parent.type)) {
          this.config.enter.data.call(this, token);
          exitData.call(this, token);
        }
      },
    },
  };

  return {
    extension,
    capture(tree) {
      const visit = (node: Nodes): void => {
        if (node.type === "text") {
          const values = segments.get(node);
          const value = compiledValues.get(node);
          if (values && value !== undefined) sourceText.set(sourceKey(node), { value, segments: values });
        }
        if ("children" in node) node.children.forEach(visit);
      };
      visit(tree);
    },
    offset(node, sourceOffset) {
      const record = sourceText.get(sourceKey(node));
      // A supplied render AST or remark transform can change text without
      // updating positions. Source offsets must never slice that new value.
      if (!record || record.value !== node.value) return undefined;
      let low = 0;
      let high = record.segments.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (record.segments[middle].sourceEnd < sourceOffset) low = middle + 1;
        else high = middle;
      }
      const segment = record.segments[low];
      if (!segment || sourceOffset < segment.sourceStart) return undefined;
      if (sourceOffset === segment.sourceStart) return segment.textStart;
      if (sourceOffset === segment.sourceEnd) return segment.textEnd;
      if (segment.sourceEnd - segment.sourceStart !== segment.textEnd - segment.textStart) return undefined;
      return segment.textStart + sourceOffset - segment.sourceStart;
    },
  };
}
