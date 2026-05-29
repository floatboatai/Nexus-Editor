import {
  type Extension,
  type Range,
  type SelectionRange,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Content, Parent, Root } from "mdast";

import type { InteractionGuardType, ParserLike, WidgetDefinition, WidgetRenderContext } from "./types";

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

/**
 * Tracks active interaction guards across all widget instances.
 * When any guard is active, the widget StateField skips decoration
 * rebuilds and uses `decos.map(tr.changes)` instead.
 */
class WidgetGuardState {
  private guards = new Map<string, Set<InteractionGuardType>>();

  acquire(widgetId: string, type: InteractionGuardType): void {
    let set = this.guards.get(widgetId);
    if (!set) {
      set = new Set();
      this.guards.set(widgetId, set);
    }
    set.add(type);
  }

  release(widgetId: string, type: InteractionGuardType): void {
    const set = this.guards.get(widgetId);
    if (set) {
      set.delete(type);
      if (set.size === 0) {
        this.guards.delete(widgetId);
      }
    }
  }

  releaseAll(widgetId: string): void {
    this.guards.delete(widgetId);
  }

  hasActiveGuards(): boolean {
    return this.guards.size > 0;
  }

  hasGuard(widgetId: string): boolean {
    const set = this.guards.get(widgetId);
    return set !== undefined && set.size > 0;
  }
}

// Singleton guard state shared across all widget instances
const globalGuardState = new WidgetGuardState();

let widgetIdCounter = 0;

class NexusWidget extends WidgetType {
  private widgetId = `widget-${++widgetIdCounter}`;

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

  eq(other: NexusWidget): boolean {
    // If this widget has active guards, return true to prevent DOM recreation
    if (globalGuardState.hasGuard(this.widgetId)) {
      return true;
    }
    return (
      other.definition === this.definition &&
      other.from === this.from &&
      other.to === this.to &&
      other.source === this.source
    );
  }

  toDOM(): HTMLElement {
    const self = this;
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
      acquireGuard: (type: InteractionGuardType) => {
        globalGuardState.acquire(self.widgetId, type);
      },
      releaseGuard: (type: InteractionGuardType) => {
        globalGuardState.release(self.widgetId, type);
      },
    };
    const el = this.definition.render(this.node, this.source, ctx);
    el.setAttribute("data-nexus-widget", this.definition.nodeType);
    el.setAttribute("data-nexus-widget-id", this.widgetId);
    return el;
  }

  destroy(dom: HTMLElement): void {
    // Release all guards for this widget to prevent leaks
    globalGuardState.releaseAll(this.widgetId);
    this.definition.destroy?.(dom);
  }

  ignoreEvent(): boolean {
    return this.definition.ignoreEvents === true;
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
      if (tr.docChanged || tr.selection) {
        // When any widget has active interaction guards, skip the full
        // rebuild and map existing decorations instead. This prevents
        // CM6 from destroying widget DOM mid-interaction (e.g., during
        // a drag or cell edit).
        if (globalGuardState.hasActiveGuards()) {
          return tr.changes ? decos.map(tr.changes) : decos;
        }
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

  return [field, viewCapture];
}
