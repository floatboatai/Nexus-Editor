import { WidgetType } from "@codemirror/view";

export function createWidget(
  source: HTMLElement | (() => HTMLElement),
  swallowEvents = false,
  heightHint?: number,
  eqKey?: string,
): WidgetType {
  // Lazy builders avoid constructing off-viewport widget DOM. Callers that
  // provide an eqKey opt into DOM reuse across decoration-only rebuilds.
  let element: HTMLElement | null = typeof source === "function" ? null : source;
  const builder = typeof source === "function" ? source : null;

  return new (class extends WidgetType {
    readonly _eqKey = eqKey;

    toDOM(): HTMLElement {
      if (element) return element;
      element = builder!();
      return element;
    }

    eq(other: WidgetType): boolean {
      if (this._eqKey === undefined) return false;
      return (other as { _eqKey?: string })._eqKey === this._eqKey;
    }

    ignoreEvent(): boolean {
      return swallowEvents;
    }

    get estimatedHeight(): number {
      // A height hint keeps block widgets from temporarily collapsing the
      // CodeMirror heightmap before their first measurement.
      return heightHint ?? -1;
    }
  })();
}
