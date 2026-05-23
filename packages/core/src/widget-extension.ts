import {
  type Extension,
  type Range,
  type SelectionRange,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Content, Parent, Root } from "mdast";

import type { ParserLike, WidgetDefinition, WidgetRenderContext } from "./types";

function createEmptyAst(): Root {
  return { type: "root", children: [] };
}

function parseDocument(parser: ParserLike, markdown: string): Root {
  try {
    return parser.parse(markdown);
  } catch {
    return createEmptyAst();
  }
}

function selectionIntersects(
  from: number,
  to: number,
  selection: readonly SelectionRange[]
): boolean {
  return selection.some((range) => {
    const rangeFrom = Math.min(range.anchor, range.head);
    const rangeTo = Math.max(range.anchor, range.head);

    if (range.empty) {
      return range.anchor >= from && range.anchor <= to;
    }

    return rangeFrom < to && from < rangeTo;
  });
}

interface WidgetRange {
  from: number;
  to: number;
  node: Content;
  source: string;
  definition: WidgetDefinition;
}

function collectWidgetRanges(
  ast: Root,
  doc: string,
  selection: readonly SelectionRange[],
  widgets: WidgetDefinition[]
): WidgetRange[] {
  const ranges: WidgetRange[] = [];

  function visit(parent: Parent | Root): void {
    for (const child of parent.children) {
      const from = child.position?.start.offset;
      const to = child.position?.end.offset;

      if (typeof from === "number" && typeof to === "number") {
        const matched = widgets.find(
          (w) => w.nodeType === child.type && (!w.match || w.match(child))
        );

        if (matched && !selectionIntersects(from, to, selection)) {
          ranges.push({
            from,
            to,
            node: child,
            source: doc.slice(from, to),
            definition: matched,
          });
          continue;
        }
      }

      if ("children" in child && Array.isArray(child.children)) {
        visit(child as Parent);
      }
    }
  }

  visit(ast);
  return ranges.sort((a, b) => a.from - b.from);
}

class NexusWidget extends WidgetType {
  constructor(
    private definition: WidgetDefinition,
    private node: Content,
    private source: string,
    private from: number,
    private to: number,
    private viewRef: { current: EditorView | null }
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    if (!(other instanceof NexusWidget)) return false;
    if (other.definition !== this.definition) return false;
    if (this.definition.eq) {
      return this.definition.eq(
        { node: other.node, source: other.source },
        { node: this.node, source: this.source }
      );
    }
    return (
      other.from === this.from &&
      other.to === this.to &&
      other.source === this.source
    );
  }

  updateDOM(dom: HTMLElement): boolean {
    if (this.definition.update) {
      this.definition.update(dom, this.node, this.source);
      return true;
    }
    return false;
  }

  toDOM(): HTMLElement {
    const ctx: WidgetRenderContext = {
      from: this.from,
      to: this.to,
      setSelection: (anchor, head) => {
        const v = this.viewRef.current;
        if (!v) return;
        const safeAnchor = Math.max(0, Math.min(anchor, v.state.doc.length));
        const safeHead = head === undefined
          ? safeAnchor
          : Math.max(0, Math.min(head, v.state.doc.length));
        v.dispatch({ selection: { anchor: safeAnchor, head: safeHead } });
      },
      focus: () => {
        this.viewRef.current?.focus();
      },
    };
    const el = this.definition.render(this.node, this.source, ctx);
    el.setAttribute("data-nexus-widget", this.definition.nodeType);
    return el;
  }

  destroy(dom: HTMLElement): void {
    this.definition.destroy?.(dom);
  }

  get estimatedHeight(): number {
    return this.definition.estimatedHeight ?? -1;
  }

  ignoreEvent(): boolean {
    return this.definition.ignoreEvents === true;
  }
}

export function createWidgetExtension(
  parser: ParserLike,
  widgets: WidgetDefinition[]
): Extension[] {
  if (widgets.length === 0) return [];

  const viewRef: { current: EditorView | null } = { current: null };

  let cachedDoc: string | null = null;
  let cachedAst: Root | null = null;

  function getAst(doc: string): Root {
    if (cachedDoc === doc && cachedAst) return cachedAst;
    cachedAst = parseDocument(parser, doc);
    cachedDoc = doc;
    return cachedAst;
  }

  function buildDecos(doc: string, selection: readonly SelectionRange[]): DecorationSet {
    const ast = getAst(doc);
    const ranges = collectWidgetRanges(ast, doc, selection, widgets);
    const decos: Range<Decoration>[] = [];

    for (const range of ranges) {
      const isBlock = range.definition.block !== false;
      decos.push(
        Decoration.replace({
          widget: new NexusWidget(
            range.definition,
            range.node,
            range.source,
            range.from,
            range.to,
            viewRef
          ),
          block: isBlock,
        }).range(range.from, range.to)
      );
    }

    return Decoration.set(decos, true);
  }

  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildDecos(state.doc.toString(), state.selection.ranges);
    },
    update(decos: DecorationSet, tr: Transaction) {
      if (tr.docChanged || tr.selection) {
        return buildDecos(tr.state.doc.toString(), tr.state.selection.ranges);
      }
      return decos;
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  const viewCapture = ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        viewRef.current = view;
      }
      update(): void {
        viewRef.current = this.view;
      }
      destroy(): void {
        if (viewRef.current === this.view) viewRef.current = null;
      }
    }
  );

  return [field, viewCapture];
}
