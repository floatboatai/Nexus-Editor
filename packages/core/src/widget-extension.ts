import {
  type Extension,
  type Range,
  type SelectionRange,
  type Text,
  StateEffect,
  StateField,
  type Transaction,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Content, Parent, Root } from "mdast";

import { editorContributionRefreshEffect } from "./dynamic-contributions";
import type { ParserLike, WidgetDefinition, WidgetRenderContext } from "./types";
import {
  applyMarkdownTransformSnapshots,
  getMarkdownTransformRevision,
  getWidgetDefinitionContributions,
  getWidgetDefinitionRevision,
} from "./markdown-contributions";

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

  eq(other: NexusWidget): boolean {
    return (
      other.definition === this.definition &&
      other.from === this.from &&
      other.to === this.to &&
      other.source === this.source
    );
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

  ignoreEvent(): boolean {
    return this.definition.ignoreEvents === true;
  }
}

// 作者：tobegold574（2026/9/17）
// 原因：签名调整——解析（parser/widgets 参数）与 AST 构建职责上移到
// createWidgetExtension 的缓存层，本函数改为接收已解析好的 definitions 与
// ast，只负责范围收集与装饰生成；产出行为与原实现完全一致。
function buildWidgetDecorations(
  state: import("@codemirror/state").EditorState,
  doc: string,
  selection: readonly SelectionRange[],
  definitions: WidgetDefinition[],
  viewRef: { current: EditorView | null },
  ast: Root
): DecorationSet {
  if (definitions.length === 0) return Decoration.none;

  const ranges = collectWidgetRanges(ast, doc, selection, definitions);
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
  const viewRef: { current: EditorView | null } = { current: null };
  const rebuildAfterComposition = StateEffect.define<null>();

  // 作者：tobegold574（2026/9/17）
  // 原因：单条目 mdast 缓存，键为不可变 Text 对象 + markdown transform 版本。
  // 解析+变换后的 AST（以及物化的文档串）只取决于（文档, transform 快照），
  // 与 selection 无关——纯光标移动原先每次都要整体无头重解析，现在两者复用。
  // widget 区间仍每次重算：其显隐随光标切换（selectionIntersects），行为不变。
  let lastAst: { docText: Text; revision: string; doc: string; ast: Root } | null = null;

  const build = (state: import("@codemirror/state").EditorState): DecorationSet => {
    // 作者：tobegold574（2026/9/17）
    // 原因：先解析 widget 定义、再物化文档——最常见的"未配置任何 widget"场景
    // 不该在每次更新时白付一次全文档拷贝（原实现在空检查之前就 toString）。
    const dynamicWidgets = getWidgetDefinitionContributions(state).map((item) => item.definition);
    const definitions = [...widgets, ...dynamicWidgets];
    if (definitions.length === 0) return Decoration.none;

    const revision = getMarkdownTransformRevision(state);
    const cached =
      lastAst && lastAst.docText === state.doc && lastAst.revision === revision ? lastAst : null;
    const doc = cached ? cached.doc : state.doc.toString();
    let ast: Root;
    if (cached) {
      ast = cached.ast;
    } else {
      ast = applyMarkdownTransformSnapshots(state, parseDocument(parser, doc));
      lastAst = { docText: state.doc, revision, doc, ast };
    }
    return buildWidgetDecorations(
      state,
      doc,
      state.selection.ranges,
      definitions,
      viewRef,
      ast
    );
  };

  const field = StateField.define<DecorationSet>({
    create(state) {
      return build(state);
    },
    update(decos: DecorationSet, tr: Transaction) {
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
