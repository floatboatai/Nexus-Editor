import { RangeSetBuilder, type Extension, type SelectionRange } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { Root } from "mdast";

import { collectLivePreviewRanges } from "./live-preview-ranges";
import { renderLivePreviewNode } from "./live-preview-renderers";
import type {
  LivePreviewConfig,
  LivePreviewNodeType,
  LivePreviewRenderer,
  ParserLike
} from "./types";

interface NormalizedLivePreviewConfig {
  enabled: boolean;
  renderers: Partial<Record<LivePreviewNodeType, LivePreviewRenderer>>;
}

function createEmptyAst(): Root {
  return {
    type: "root",
    children: []
  };
}

function parseDocument(parser: ParserLike, markdown: string): Root {
  try {
    return parser.parse(markdown);
  } catch {
    return createEmptyAst();
  }
}

function normalizeConfig(
  config: boolean | LivePreviewConfig | undefined
): NormalizedLivePreviewConfig {
  if (!config) {
    return {
      enabled: false,
      renderers: {}
    };
  }

  if (config === true) {
    return {
      enabled: true,
      renderers: {}
    };
  }

  return {
    enabled: config.enabled ?? true,
    renderers: config.renderers ?? {}
  };
}

function createWidget(element: HTMLElement): WidgetType {
  return new (class extends WidgetType {
    toDOM() {
      return element;
    }

    ignoreEvent() {
      return false;
    }
  })();
}

function buildDecorations(
  view: EditorView,
  parser: ParserLike,
  config: NormalizedLivePreviewConfig
) {
  if (!config.enabled) {
    return Decoration.none;
  }

  const doc = view.state.doc.toString();
  const ast = parseDocument(parser, doc);
  const builder = new RangeSetBuilder<Decoration>();
  const ranges = collectLivePreviewRanges(ast, doc, view.state.selection.ranges);

  for (const range of ranges) {
    builder.add(
      range.from,
      range.to,
      Decoration.replace({
        widget: createWidget(renderLivePreviewNode(range.node, range.source, config.renderers))
      })
    );
  }

  return builder.finish();
}

export function createLivePreviewExtension(
  parser: ParserLike,
  config: boolean | LivePreviewConfig | undefined
): Extension[] {
  const normalized = normalizeConfig(config);

  if (!normalized.enabled) {
    return [];
  }

  const plugin = ViewPlugin.fromClass(
    class {
      decorations;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, parser, normalized);
      }

      update(update: { docChanged: boolean; selectionSet: boolean; view: EditorView }) {
        if (update.docChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view, parser, normalized);
        }
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );

  return [plugin];
}
