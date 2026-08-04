import type { Range, SelectionRange } from "@codemirror/state";
import { Decoration, type EditorView, WidgetType } from "@codemirror/view";
import type { List } from "mdast";

import { createListReorderChange, type ListItemSourceRange } from "./list-reorder";
import { selectionIntersects } from "./live-preview-ranges";
import { createWidget } from "./live-preview-widget";

const LIST_MARKER_RE = /^(\s*)([-*+]|\d+[.)]) /;
const CHECKBOX_RE = /^\[([ xX])\] /;
const LIST_GRIP_CLASS = "nexus-list-grip";
const DRAG_INDICATOR = "var(--nexus-accent)";

interface RenderedListItem extends ListItemSourceRange {
  headLineEnd: number;
  markerEnd: number;
  ordinal: number;
}

interface ListGripConfig {
  itemIndex: number;
  items: readonly ListItemSourceRange[];
  ordered: boolean;
  label: string;
  viewRef: { current: EditorView | null };
}

function gripSelector(listFrom: number, itemIndex?: number): string {
  const item = itemIndex === undefined ? "" : `[data-item-index="${itemIndex}"]`;
  return `.${LIST_GRIP_CLASS}[data-list-from="${listFrom}"]${item}`;
}

function listIdentity(items: readonly ListItemSourceRange[], ordered: boolean): string {
  return `${ordered ? "ol" : "ul"}:${items.map((item) =>
    `${item.from}-${item.to}-${item.markerFrom}-${item.markerTo}`
  ).join(":")}`;
}

class ListGripWidget extends WidgetType {
  private cancelDrag: (() => void) | null = null;
  private readonly identity: string;

  constructor(private readonly config: ListGripConfig) {
    super();
    this.identity = listIdentity(config.items, config.ordered);
  }

  eq(other: WidgetType): boolean {
    return (
      other instanceof ListGripWidget &&
      other.config.itemIndex === this.config.itemIndex &&
      other.identity === this.identity
    );
  }

  ignoreEvent(): boolean {
    return true;
  }

  destroy(_dom: HTMLElement): void {
    this.cancelDrag?.();
  }

  private dispatchReorder(targetIndex: number, restoreFocus = false): void {
    const view = this.config.viewRef.current;
    if (!view) return;

    const change = createListReorderChange(
      view.state.doc.toString(),
      this.config.items,
      this.config.itemIndex,
      targetIndex,
      this.config.ordered,
    );
    if (!change) return;

    view.dispatch({ changes: change, userEvent: "input.list-reorder" });

    if (restoreFocus) {
      const listFrom = this.config.items[0].from;
      queueMicrotask(() => {
        const activeView = this.config.viewRef.current;
        activeView?.dom.querySelector<HTMLElement>(gripSelector(listFrom, targetIndex))?.focus();
      });
    }
  }

  toDOM(): HTMLElement {
    const view = this.config.viewRef.current;
    const ownerDocument = view?.dom.ownerDocument ?? document;
    const grip = ownerDocument.createElement("span");
    const listId = this.identity;

    grip.className = LIST_GRIP_CLASS;
    grip.dataset.listId = listId;
    grip.dataset.listFrom = String(this.config.items[0].from);
    grip.dataset.itemIndex = String(this.config.itemIndex);
    grip.dataset.itemFrom = String(this.config.items[this.config.itemIndex].from);
    grip.setAttribute("role", "button");
    grip.setAttribute("aria-label", this.config.label);
    grip.setAttribute("aria-grabbed", "false");
    grip.tabIndex = 0;
    grip.title = this.config.label;
    grip.textContent = "⠿";
    grip.style.cssText =
      "display:inline-flex;align-items:center;justify-content:center;width:14px;height:16px;" +
      "margin-right:3px;color:var(--nexus-text-muted);cursor:grab;user-select:none;" +
      "vertical-align:text-bottom;opacity:.55;transition:opacity .15s,box-shadow .15s;";

    grip.addEventListener("mouseenter", () => {
      if (grip.getAttribute("aria-grabbed") !== "true") grip.style.opacity = "1";
    });
    grip.addEventListener("mouseleave", () => {
      if (grip.getAttribute("aria-grabbed") !== "true") grip.style.opacity = ".55";
    });

    grip.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const direction = event.key === "ArrowUp" ? -1 : 1;
      const targetIndex = this.config.itemIndex + direction;
      if (targetIndex < 0 || targetIndex >= this.config.items.length) return;

      event.preventDefault();
      event.stopPropagation();
      this.dispatchReorder(targetIndex, true);
    });

    grip.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      const activeView = this.config.viewRef.current;
      if (!activeView) return;

      event.preventDefault();
      event.stopPropagation();
      grip.focus({ preventScroll: true });
      this.cancelDrag?.();

      const body = ownerDocument.body;
      const ownerWindow = ownerDocument.defaultView;
      const previousCursor = body.style.cursor;
      const previousUserSelect = body.style.userSelect;
      let targetIndex = this.config.itemIndex;

      const listGrips = (): HTMLElement[] =>
        Array.from(activeView.dom.querySelectorAll<HTMLElement>(`.${LIST_GRIP_CLASS}`))
          .filter((candidate) => candidate.dataset.listId === listId);

      const clearIndicators = (): void => {
        for (const candidate of listGrips()) candidate.style.boxShadow = "";
      };

      const resolveTargetIndex = (moveEvent: MouseEvent): number | null => {
        const eventTarget = moveEvent.target as {
          closest?: (selector: string) => Element | null;
        } | null;
        const target = eventTarget?.closest?.(`.${LIST_GRIP_CLASS}`) as HTMLElement | null;
        if (target?.dataset.listId === listId) {
          const index = Number(target.dataset.itemIndex);
          if (Number.isInteger(index)) return index;
        }

        try {
          const position = activeView.posAtCoords({ x: moveEvent.clientX, y: moveEvent.clientY });
          if (position === null) return null;
          const index = this.config.items.findIndex((item) =>
            position >= item.from && position <= item.to
          );
          return index >= 0 ? index : null;
        } catch {
          return null;
        }
      };

      const onMouseMove = (moveEvent: MouseEvent): void => {
        moveEvent.preventDefault();
        const nextTarget = resolveTargetIndex(moveEvent);
        if (nextTarget === null) {
          targetIndex = this.config.itemIndex;
          clearIndicators();
          return;
        }

        targetIndex = nextTarget;
        clearIndicators();
        if (targetIndex === this.config.itemIndex) return;

        const targetGrip = listGrips().find((candidate) =>
          Number(candidate.dataset.itemIndex) === targetIndex
        );
        if (targetGrip) {
          const edge = this.config.itemIndex < targetIndex ? "inset 0 -2px" : "inset 0 2px";
          targetGrip.style.boxShadow = `${edge} ${DRAG_INDICATOR}`;
        }
      };

      const finish = (commit: boolean): void => {
        const savedTarget = targetIndex;
        ownerDocument.removeEventListener("mousemove", onMouseMove);
        ownerDocument.removeEventListener("mouseup", onMouseUp);
        ownerDocument.removeEventListener("keydown", onKeyDown, true);
        ownerWindow?.removeEventListener("blur", onWindowBlur);
        clearIndicators();
        body.style.cursor = previousCursor;
        body.style.userSelect = previousUserSelect;
        grip.style.cursor = "grab";
        grip.style.opacity = ".55";
        grip.setAttribute("aria-grabbed", "false");
        this.cancelDrag = null;

        if (commit && savedTarget !== this.config.itemIndex) this.dispatchReorder(savedTarget);
      };

      const onMouseUp = (): void => finish(true);
      const onWindowBlur = (): void => finish(false);
      const onKeyDown = (keyEvent: KeyboardEvent): void => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.preventDefault();
        finish(false);
      };

      grip.style.cursor = "grabbing";
      grip.style.opacity = "1";
      grip.setAttribute("aria-grabbed", "true");
      body.style.cursor = "grabbing";
      body.style.userSelect = "none";
      ownerDocument.addEventListener("mousemove", onMouseMove);
      ownerDocument.addEventListener("mouseup", onMouseUp);
      ownerDocument.addEventListener("keydown", onKeyDown, true);
      ownerWindow?.addEventListener("blur", onWindowBlur);
      this.cancelDrag = () => finish(false);
    });

    return grip;
  }
}

function collectRenderedItems(list: List, doc: string): RenderedListItem[] {
  const rendered: RenderedListItem[] = [];
  let ordinal = list.start ?? 1;

  for (const item of list.children) {
    const from = item.position?.start.offset;
    const to = item.position?.end.offset;
    if (typeof from !== "number" || typeof to !== "number") continue;

    const newline = doc.indexOf("\n", from);
    const headLineEnd = newline === -1 ? doc.length : newline;
    const markerMatch = LIST_MARKER_RE.exec(doc.slice(from, headLineEnd));
    if (!markerMatch) continue;

    const markerFrom = from + markerMatch[1].length;
    const markerEnd = from + markerMatch[0].length;
    rendered.push({
      from,
      to,
      markerFrom,
      markerTo: markerEnd - 1,
      markerEnd,
      headLineEnd,
      ordinal,
    });
    if (list.ordered) ordinal++;
  }

  return rendered;
}

export function buildListDecorations(
  range: { from: number; to: number; node: List },
  doc: string,
  selection: readonly SelectionRange[],
  decos: Range<Decoration>[],
  viewRef: { current: EditorView | null },
  reorderLabel: string,
): void {
  const items = collectRenderedItems(range.node, doc);
  const sourceRanges: ListItemSourceRange[] = items.map(({ from, to, markerFrom, markerTo }) => ({
    from,
    to,
    markerFrom,
    markerTo,
  }));

  for (const [itemIndex, item] of items.entries()) {
    if (sourceRanges.length > 1) {
      decos.push(
        Decoration.widget({
          widget: new ListGripWidget({
            itemIndex,
            items: sourceRanges,
            ordered: range.node.ordered === true,
            label: reorderLabel,
            viewRef,
          }),
          side: -1,
        }).range(item.markerFrom)
      );
    }

    if (selectionIntersects(item.from, item.headLineEnd, selection, true)) continue;

    const ownerDocument = viewRef.current?.dom.ownerDocument ?? document;
    const bullet = ownerDocument.createElement("span");
    const bulletText = range.node.ordered ? `${item.ordinal}. ` : "• ";
    bullet.textContent = bulletText;
    bullet.style.color = "var(--nexus-text-muted)";
    decos.push(
      Decoration.replace({
        widget: createWidget(
          bullet,
          false,
          undefined,
          `bullet:${range.node.ordered ? "ord" : "ul"}:${bulletText}:${item.markerFrom}-${item.markerEnd}`,
        ),
      }).range(item.markerFrom, item.markerEnd)
    );

    const checkMatch = CHECKBOX_RE.exec(doc.slice(item.markerEnd, item.headLineEnd));
    if (!checkMatch) continue;

    const checkStart = item.markerEnd;
    const checkEnd = checkStart + checkMatch[0].length;
    const isChecked = checkMatch[1] !== " ";
    const checkbox = ownerDocument.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isChecked;
    checkbox.style.marginRight = "4px";
    checkbox.style.verticalAlign = "middle";
    checkbox.style.cursor = "pointer";
    checkbox.addEventListener("mousedown", (event) => event.preventDefault());
    checkbox.addEventListener("click", (event) => {
      event.preventDefault();
      const activeView = viewRef.current;
      if (!activeView) return;
      activeView.dispatch({
        changes: { from: checkStart + 1, to: checkStart + 2, insert: isChecked ? " " : "x" },
      });
    });

    decos.push(
      Decoration.replace({
        widget: createWidget(
          checkbox,
          true,
          undefined,
          `task:${checkStart}-${checkEnd}:${isChecked ? "x" : " "}`,
        ),
      }).range(checkStart, checkEnd)
    );

    if (isChecked && checkEnd < item.headLineEnd) {
      decos.push(
        Decoration.mark({
          attributes: { style: "text-decoration: line-through; color: var(--nexus-text-muted)" },
        }).range(checkEnd, item.headLineEnd)
      );
    }
  }
}
