import {
  type Extension,
  type Range,
  type SelectionRange,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Content, Parent, Root } from "mdast";

import { editorContributionRefreshEffect } from "./dynamic-contributions";
import { setInputTargetProvider } from "./input-target-provider";
import type { EditorInputTarget, ParserLike, WidgetDefinition, WidgetRenderContext } from "./types";
import {
  applyMarkdownTransformSnapshots,
  getMarkdownTransformRevision,
  getWidgetDefinitionContributions,
  getWidgetDefinitionRevision,
} from "./markdown-contributions";
import {
  beginWidgetInteraction,
  endWidgetInteraction,
  isWidgetInteracting,
  shouldReuseWidgetDom,
  widgetInteractionRefreshEffect,
} from "./widget-interaction";

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

interface ResolvedWidget {
  id: string;
  definition: WidgetDefinition;
}

interface WidgetRange {
  from: number;
  to: number;
  node: Content;
  source: string;
  contentKey: string;
  resolved: ResolvedWidget;
}

function resolveContentKey(definition: WidgetDefinition, node: Content, source: string): string {
  return definition.contentKey?.(node, source) ?? source;
}

function collectWidgetRanges(
  ast: Root,
  doc: string,
  selection: readonly SelectionRange[],
  widgets: readonly ResolvedWidget[]
): WidgetRange[] {
  const ranges: WidgetRange[] = [];

  function visit(parent: Parent | Root): void {
    for (const child of parent.children) {
      const from = child.position?.start.offset;
      const to = child.position?.end.offset;

      if (typeof from === "number" && typeof to === "number") {
        const matched = widgets.find(
          (w) => w.definition.nodeType === child.type && (!w.definition.match || w.definition.match(child))
        );

        if (matched && !selectionIntersects(from, to, selection)) {
          const source = doc.slice(from, to);
          ranges.push({
            from,
            to,
            node: child,
            source,
            contentKey: resolveContentKey(matched.definition, child, source),
            resolved: matched,
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
  private held = 0;
  private clearInputTarget: (() => void) | null = null;

  constructor(
    private readonly contributionId: string,
    private readonly definition: WidgetDefinition,
    private readonly node: Content,
    private readonly source: string,
    private readonly contentKey: string,
    private readonly from: number,
    private readonly to: number,
    private readonly viewRef: { current: EditorView | null }
  ) {
    super();
  }

  eq(other: NexusWidget): boolean {
    return shouldReuseWidgetDom(this.viewRef.current, (
      other.contributionId === this.contributionId &&
      other.from === this.from &&
      other.to === this.to &&
      other.contentKey === this.contentKey
    ));
  }

  get estimatedHeight(): number {
    return this.definition.estimatedHeight ?? -1;
  }

  toDOM(): HTMLElement {
    let pendingTarget: Omit<EditorInputTarget, "element"> | null = null;
    let mounted: HTMLElement | null = null;
    let bindGeneration = 0;

    const bindInputTarget = (root: HTMLElement, target: Omit<EditorInputTarget, "element">): (() => void) => {
      const generation = ++bindGeneration;
      this.clearInputTarget?.();
      this.clearInputTarget = setInputTargetProvider(root, {
        resolveInputTarget: () => ({ ...target, element: root }),
      });
      return () => {
        if (generation !== bindGeneration) return;
        pendingTarget = null;
        this.clearInputTarget?.();
        this.clearInputTarget = null;
      };
    };

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
      beginInteraction: () => {
        const v = this.viewRef.current;
        if (!v) return;
        this.held += 1;
        beginWidgetInteraction(v);
      },
      endInteraction: () => {
        if (this.held <= 0) return;
        this.held -= 1;
        const v = this.viewRef.current;
        if (v) endWidgetInteraction(v);
      },
      isInteracting: () => isWidgetInteracting(this.viewRef.current),
      registerInputTarget: (target) => {
        if (mounted) return bindInputTarget(mounted, target);
        pendingTarget = target;
        const generation = ++bindGeneration;
        return () => {
          if (generation !== bindGeneration) return;
          pendingTarget = null;
          this.clearInputTarget?.();
          this.clearInputTarget = null;
        };
      },
    };
    const el = this.definition.render(this.node, this.source, ctx);
    el.setAttribute("data-nexus-widget", this.definition.nodeType);
    el.setAttribute("data-nexus-widget-id", this.contributionId);
    mounted = el;
    if (pendingTarget) bindInputTarget(el, pendingTarget);
    return el;
  }

  destroy(dom: HTMLElement): void {
    this.clearInputTarget?.();
    this.clearInputTarget = null;
    const v = this.viewRef.current;
    while (this.held > 0) {
      this.held -= 1;
      if (v) endWidgetInteraction(v, { refresh: false });
    }
    this.definition.destroy?.(dom);
  }

  ignoreEvent(): boolean {
    return this.definition.ignoreEvents === true;
  }
}

function resolveWidgets(
  state: import("@codemirror/state").EditorState,
  widgets: WidgetDefinition[],
): ResolvedWidget[] {
  const staticWidgets = widgets.map((definition, index) => ({
    id: `static:${index}:${definition.nodeType}`,
    definition,
  }));
  const dynamicWidgets = getWidgetDefinitionContributions(state).map((item) => ({
    id: item.id,
    definition: item.definition,
  }));
  return [...staticWidgets, ...dynamicWidgets];
}

function buildWidgetDecorations(
  state: import("@codemirror/state").EditorState,
  doc: string,
  selection: readonly SelectionRange[],
  parser: ParserLike,
  widgets: WidgetDefinition[],
  viewRef: { current: EditorView | null }
): DecorationSet {
  const resolved = resolveWidgets(state, widgets);
  if (resolved.length === 0) return Decoration.none;

  const ast = applyMarkdownTransformSnapshots(state, parseDocument(parser, doc));
  const ranges = collectWidgetRanges(ast, doc, selection, resolved);
  const decos: Range<Decoration>[] = [];

  for (const range of ranges) {
    const isBlock = range.resolved.definition.block !== false;
    decos.push(
      Decoration.replace({
        widget: new NexusWidget(
          range.resolved.id,
          range.resolved.definition,
          range.node,
          range.source,
          range.contentKey,
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
  const viewRef: { current: EditorView | null } = { current: null };
  const rebuildAfterComposition = StateEffect.define<null>();

  const build = (state: import("@codemirror/state").EditorState): DecorationSet => {
    return buildWidgetDecorations(
      state,
      state.doc.toString(),
      state.selection.ranges,
      parser,
      widgets,
      viewRef,
    );
  };

  const field = StateField.define<DecorationSet>({
    create(state) {
      return build(state);
    },
    update(decos: DecorationSet, tr: Transaction) {
      if (isWidgetInteracting(viewRef.current)) {
        return tr.docChanged ? decos.map(tr.changes) : decos;
      }
      if (tr.effects.some((effect) => effect.is(widgetInteractionRefreshEffect))) {
        return build(tr.state);
      }
      if (tr.effects.some((effect) => effect.is(rebuildAfterComposition))) {
        return build(tr.state);
      }
      if (tr.effects.some((effect) => effect.is(editorContributionRefreshEffect))) {
        return build(tr.state);
      }
      if (
        getMarkdownTransformRevision(tr.startState) !== getMarkdownTransformRevision(tr.state) ||
        getWidgetDefinitionRevision(tr.startState) !== getWidgetDefinitionRevision(tr.state)
      ) {
        return build(tr.state);
      }
      if (tr.isUserEvent("input.type.compose")) {
        return tr.docChanged ? decos.map(tr.changes) : decos;
      }
      if (tr.docChanged || tr.selection) {
        return build(tr.state);
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
