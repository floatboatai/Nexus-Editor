import {
  type Extension,
  type Range,
  type SelectionRange,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";
import type { Content, Parent, Root } from "mdast";

import type { ParserLike, WidgetDefinition, WidgetRenderContext } from "./types";
import { EditorWidget } from "./widget-base";
import type { WidgetContext } from "./widget-context";

const COMPOSITION_REDECORATE_DELAY_MS = 60;

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
      // Inclusive at `to` so clicking just after a block widget (cursor at
      // the widget end) toggles into edit mode. Without this, block widgets
      // like math `$$...$$` render correctly but can never be entered for
      // editing — CM6's click-to-pos usually lands the cursor at the end of
      // the widget range, not inside it.
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

class NexusWidget extends EditorWidget {
  private _sourceChanged = false;

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

  /** @override — compare by definition identity + position + source. */
  protected eqKey(other: NexusWidget): boolean {
    return (
      other.definition === this.definition &&
      other.from === this.from &&
      other.to === this.to &&
      other.source === this.source
    );
  }

  /** @override */
  protected buildDOM(): HTMLElement {
    // Capture the widget instance so arrow functions below can access it
    // without `this` being shadowed by the ctx object literal.
    const widget = this;

    const ctx: WidgetContext = {
      view: widget.viewRef.current!,
      from: widget.from,
      to: widget.to,
      dispatch: (changes) => {
        const v = widget.viewRef.current;
        if (!v) return;
        v.dispatch({
          changes: { from: changes.from, to: changes.to, insert: changes.insert },
        });
      },
      isCursorInside: () => {
        const v = widget.viewRef.current;
        if (!v) return false;
        const sel = v.state.selection.main;
        const anchor = Math.min(sel.anchor, sel.head);
        const head = Math.max(sel.anchor, sel.head);
        return anchor < widget.to && widget.from < head;
      },
      requestMeasure<T>(req: { read(view: EditorView): T; write?(value: T, view: EditorView): void }) {
        widget.viewRef.current?.requestMeasure(req);
      },
    };

    // Build legacy WidgetRenderContext for backward compat
    const legacyCtx: WidgetRenderContext = {
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

    // Store ctx for lifecycle hooks
    this.ctx = ctx;

    const el = this.definition.render(this.node, this.source, legacyCtx);
    el.setAttribute("data-nexus-widget", this.definition.nodeType);

    // Call lifecycle.didMount if provided
    this.definition.lifecycle?.didMount?.(ctx);

    return el;
  }

  /** @override */
  didMount(ctx: WidgetContext): void {
    // Already called in buildDOM for backward compat; noop here.
  }

  /** @override */
  willDestroy(ctx: WidgetContext): void {
    // Call new lifecycle hook first
    this.definition.lifecycle?.willDestroy?.(ctx);
    // Fall back to legacy destroy callback
    this.definition.destroy?.(this.dom!);
  }
}

function buildWidgetDecorations(
  doc: string,
  selection: readonly SelectionRange[],
  parser: ParserLike,
  widgets: WidgetDefinition[],
  viewRef: { current: EditorView | null }
): DecorationSet {
  const ast = parseDocument(parser, doc);
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

export function createWidgetExtension(
  parser: ParserLike,
  widgets: WidgetDefinition[]
): Extension[] {
  if (widgets.length === 0) return [];

  const viewRef: { current: EditorView | null } = { current: null };
  const rebuildAfterComposition = StateEffect.define<null>();

  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildWidgetDecorations(
        state.doc.toString(),
        state.selection.ranges,
        parser,
        widgets,
        viewRef
      );
    },
    update(decos: DecorationSet, tr: Transaction) {
      if (tr.effects.some((effect) => effect.is(rebuildAfterComposition))) {
        return buildWidgetDecorations(
          tr.state.doc.toString(),
          tr.state.selection.ranges,
          parser,
          widgets,
          viewRef
        );
      }
      if (tr.isUserEvent("input.type.compose")) {
        return tr.docChanged ? decos.map(tr.changes) : decos;
      }
      if (tr.docChanged || tr.selection) {
        return buildWidgetDecorations(
          tr.state.doc.toString(),
          tr.state.selection.ranges,
          parser,
          widgets,
          viewRef
        );
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

  const compositionHandler = EditorView.domEventHandlers({
    compositionend(_event, view) {
      setTimeout(() => {
        if (view.compositionStarted) return;
        try {
          view.dispatch({ effects: rebuildAfterComposition.of(null) });
        } catch {
          // The view may have been destroyed before the deferred rebuild.
        }
      }, COMPOSITION_REDECORATE_DELAY_MS);
      return false;
    },
  });

  return [field, viewCapture, compositionHandler];
}
