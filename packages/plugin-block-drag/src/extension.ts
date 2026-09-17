import { isolateHistory } from "@codemirror/commands";
import { foldedRanges, syntaxTree } from "@codemirror/language";
import type { Extension, Text } from "@codemirror/state";
import {
  Direction,
  EditorView,
  ViewPlugin,
  keymap,
  type ViewUpdate,
} from "@codemirror/view";
import { editorTransactionOrigin, prepareBlockMove } from "@floatboat/nexus-core";

import { planBlockMove, readBlocks, type BlockMove, type MarkdownBlock } from "./model";

export interface BlockDragOptions {
  /** Disable for hosts whose command service owns keyboard bindings. */
  readonly keyboard?: boolean;
  readonly label?: string;
  readonly movedMessage?: string;
  readonly blockedMessage?: string;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Gesture {
  readonly pointerId: number;
  readonly start: Point;
  readonly document: Text;
  readonly blocks: readonly MarkdownBlock[];
  readonly source: number;
  active: boolean;
  target: number;
  plan: BlockMove | null;
}

interface Layout {
  readonly root: DOMRect;
  readonly scroll: DOMRect;
  readonly content: DOMRect;
  readonly scrollLeft: number;
  readonly source: { top: number; bottom: number } | null;
  readonly block: MarkdownBlock | null;
  readonly destination: number | null;
}

const GUTTER_WIDTH = 28;
const HANDLE_WIDTH = 24;
const HANDLE_HEIGHT = 26;
const HANDLE_INSET = 1;
const DRAG_THRESHOLD = 5;
const AUTO_SCROLL_EDGE = 40;
const AUTO_SCROLL_MAX_STEP = 16;

const controllers = new WeakMap<EditorView, BlockDragController>();

class BlockDragController {
  private readonly ownerDocument: Document;
  private readonly ownerWindow: Window;
  private readonly overlay: HTMLDivElement;
  private readonly handle: HTMLButtonElement;
  private readonly highlight: HTMLDivElement;
  private readonly indicator: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly disposers: Array<() => void> = [];
  private blocks: readonly MarkdownBlock[];
  private hovered: MarkdownBlock | null = null;
  private point: Point | null = null;
  private gesture: Gesture | null = null;
  private frame: number | null = null;
  private stopped = false;
  private focusHandleAfterLayout = false;

  constructor(
    private readonly view: EditorView,
    private readonly options: BlockDragOptions,
  ) {
    this.ownerDocument = view.dom.ownerDocument;
    this.ownerWindow = this.ownerDocument.defaultView!;
    this.blocks = readBlocks(view.state);
    this.overlay = this.createElement("nexus-block-drag");
    this.handle = this.ownerDocument.createElement("button");
    this.handle.type = "button";
    this.handle.className = "nexus-block-drag-handle";
    this.handle.textContent = "⠿";
    this.handle.title = options.label ?? "Move block";
    this.handle.setAttribute("aria-label", this.handle.title);
    this.handle.hidden = true;
    this.highlight = this.createElement("nexus-block-drag-highlight");
    this.indicator = this.createElement("nexus-block-drag-indicator");
    this.highlight.hidden = this.indicator.hidden = true;
    this.status = this.createElement("nexus-block-drag-status");
    this.status.setAttribute("role", "status");
    this.overlay.append(this.highlight, this.indicator, this.handle, this.status);
    view.dom.append(this.overlay);
    this.listen(view.dom, "pointermove", this.hover);
    this.listen(view.dom, "pointerleave", () => {
      if (this.gesture || this.ownerDocument.activeElement === this.handle) return;
      this.point = null;
      this.hovered = null;
      this.measure();
    });
    this.listen(this.handle, "pointerdown", this.begin);
    this.listen(this.handle, "mousedown", (event) => event.preventDefault());
    this.listen(this.handle, "keydown", this.handleKey);
    this.listen(this.handle, "focus", () => this.measure());
    this.listen(this.handle, "blur", () => this.measure());
    this.listen(this.ownerWindow, "pointermove", this.drag);
    this.listen(this.ownerWindow, "pointerup", this.drop);
    this.listen(this.ownerWindow, "pointercancel", this.cancelPointer);
    this.listen(this.handle, "lostpointercapture", this.cancelPointer);
    this.listen(this.ownerWindow, "blur", () => this.cancel());
    this.listen(this.ownerWindow, "resize", () => this.measure());
    this.listen(view.scrollDOM, "scroll", () => this.measure());
    this.listen(
      this.ownerWindow,
      "keydown",
      (event) => {
        if ((event as KeyboardEvent).key === "Escape" && this.gesture) {
          event.preventDefault();
          event.stopPropagation();
          this.cancel();
        }
      },
      true,
    );
    controllers.set(view, this);
    this.measure();
  }

  update(update: ViewUpdate): void {
    if (this.stopped) return;
    if (update.docChanged) {
      this.cancel();
      this.hovered = null;
      this.handle.hidden = true;
    }
    if (syntaxTree(update.startState) !== syntaxTree(update.state)) this.cancel();
    if (
      update.docChanged ||
      this.blocks.length === 0 ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    ) {
      this.blocks = readBlocks(update.state);
    }
    if (
      this.view.composing ||
      update.state.readOnly ||
      (this.gesture && !this.visibleBlock(this.gesture.blocks[this.gesture.source]))
    ) {
      this.cancel();
    }
    if (
      update.docChanged ||
      update.selectionSet ||
      update.geometryChanged ||
      update.viewportChanged ||
      update.focusChanged ||
      update.startState.readOnly !== update.state.readOnly
    ) {
      this.measure();
    }
  }

  canMove(direction: -1 | 1): boolean {
    this.blocks = readBlocks(this.view.state);
    if (!this.editable()) return false;
    const index = this.currentIndex();
    return (
      index >= 0 &&
      this.visibleBlock(this.blocks[index]) &&
      this.plan(index, direction < 0 ? index - 1 : index + 2) !== null
    );
  }

  move(direction: -1 | 1, fromHandle = false): boolean {
    if (!this.editable()) return false;
    this.blocks = readBlocks(this.view.state);
    const index = fromHandle && this.hovered
      ? this.blocks.findIndex((block) => block.from === this.hovered!.from)
      : this.currentIndex();
    if (index < 0 || !this.visibleBlock(this.blocks[index])) return false;
    this.cancel();
    if (!this.prepareBlocks()) {
      this.announce(false);
      return true;
    }
    const plan = this.plan(index, direction < 0 ? index - 1 : index + 2);
    if (plan) {
      this.commit(plan, fromHandle);
    } else {
      this.announce(false);
    }
    return true;
  }

  stop(): void {
    this.cancel();
    this.stopped = true;
    this.focusHandleAfterLayout = false;
    this.overlay.hidden = true;
  }

  destroy(): void {
    this.stop();
    this.disposers.forEach((dispose) => dispose());
    this.overlay.remove();
    if (controllers.get(this.view) === this) controllers.delete(this.view);
  }

  private editable(): boolean {
    if (this.stopped || this.view.state.readOnly || this.view.composing) return false;
    const active = this.ownerDocument.activeElement;
    return !active || active === this.view.contentDOM || !this.view.contentDOM.contains(active);
  }

  private currentIndex(): number {
    const position = this.view.state.selection.main.head;
    return this.blocks.findIndex((block) => block.from <= position && position <= block.to);
  }

  private prepareBlocks(): boolean {
    const before = this.view.state.doc;
    const previous = this.blocks;
    if (previous.length === 0 || !prepareBlockMove(this.view)) return false;
    this.blocks = readBlocks(this.view.state);
    if (this.blocks.length !== previous.length) return false;
    // A pending table edit may change offsets, but splitting or merging blocks
    // would make the captured source index refer to different content.
    return previous.every((block, index) => {
      const current = this.blocks[index];
      return block.type === current.type && (
        block.type === "Table" ||
        before.sliceString(block.from, block.to) ===
          this.view.state.doc.sliceString(current.from, current.to)
      );
    });
  }

  private visibleBlock(block: MarkdownBlock): boolean {
    if (!block.movable || this.stopped || this.view.state.readOnly || this.view.composing) return false;
    let hidden = false;
    foldedRanges(this.view.state).between(
      block.from,
      Math.min(block.to + 1, this.view.state.doc.length),
      (from) => {
        if (from <= block.from || block.type.includes("Heading")) hidden = true;
      },
    );
    return !hidden;
  }

  private createElement(className: string): HTMLDivElement {
    const element = this.ownerDocument.createElement("div");
    element.className = className;
    return element;
  }

  private listen(
    target: EventTarget,
    type: string,
    listener: EventListener,
    capture = false,
  ): void {
    target.addEventListener(type, listener, capture);
    this.disposers.push(() => target.removeEventListener(type, listener, capture));
  }

  private readonly hover = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (this.stopped || this.gesture || pointer.pointerType === "touch") return;
    this.point = { x: pointer.clientX, y: pointer.clientY };
    if (event.target !== this.handle) this.measure();
  };

  private readonly begin = (event: Event): void => {
    const pointer = event as PointerEvent;
    if (
      pointer.button !== 0 ||
      pointer.pointerType === "touch" ||
      !this.hovered ||
      !this.visibleBlock(this.hovered)
    ) return;
    event.preventDefault();
    const source = this.blocks.findIndex((block) => block.from === this.hovered!.from);
    this.cancel();
    if (!this.prepareBlocks()) {
      this.announce(false);
      return;
    }
    if (source < 0 || source >= this.blocks.length || !this.visibleBlock(this.blocks[source])) return;
    this.point = { x: pointer.clientX, y: pointer.clientY };
    this.gesture = {
      pointerId: pointer.pointerId,
      start: this.point,
      document: this.view.state.doc,
      blocks: this.blocks,
      source,
      active: false,
      target: -1,
      plan: null,
    };
    try {
      this.handle.setPointerCapture(pointer.pointerId);
    } catch {
      // Window listeners also cover hosts that cannot capture this pointer.
    }
  };

  private readonly drag = (event: Event): void => {
    const pointer = event as PointerEvent;
    const gesture = this.gesture;
    if (!gesture || pointer.pointerId !== gesture.pointerId) return;
    if ((pointer.buttons & 1) === 0 || this.view.composing || this.view.state.readOnly) {
      this.cancel();
      return;
    }
    event.preventDefault();
    this.point = { x: pointer.clientX, y: pointer.clientY };
    if (
      !gesture.active &&
      Math.hypot(this.point.x - gesture.start.x, this.point.y - gesture.start.y) >= DRAG_THRESHOLD
    ) {
      gesture.active = true;
      this.overlay.classList.add("is-dragging");
      this.frame = this.ownerWindow.requestAnimationFrame(this.scroll);
    }
    this.measure();
  };

  private readonly drop = (event: Event): void => {
    const pointer = event as PointerEvent;
    const gesture = this.gesture;
    if (!gesture || pointer.pointerId !== gesture.pointerId) return;
    let plan: BlockMove | null = null;
    if (
      gesture.active &&
      gesture.document === this.view.state.doc &&
      this.visibleBlock(gesture.blocks[gesture.source])
    ) {
      const target = this.gapAt({ x: pointer.clientX, y: pointer.clientY });
      plan = this.plan(gesture.source, target);
    }
    this.cancel();
    if (plan && prepareBlockMove(this.view) && gesture.document === this.view.state.doc) {
      this.commit(plan);
    }
  };

  private readonly cancelPointer = (event: Event): void => {
    if ((event as PointerEvent).pointerId === this.gesture?.pointerId) this.cancel();
  };

  private readonly handleKey = (event: Event): void => {
    const key = (event as KeyboardEvent).key;
    if (key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      this.move(key === "ArrowUp" ? -1 : 1, true);
    } else if (key === "Escape") {
      event.preventDefault();
      this.cancel();
      this.view.focus();
    }
  };

  private commit(plan: BlockMove, fromHandle = false): void {
    const before = this.view.state.doc;
    this.view.dispatch({
      changes: plan.changes,
      selection: plan.selection,
      userEvent: "move.block",
      annotations: [editorTransactionOrigin.of(["block-drag"]), isolateHistory.of("full")],
      effects: EditorView.scrollIntoView(plan.movedFrom, { y: "nearest" }),
    });
    this.point = null;
    this.hovered = fromHandle
      ? (this.view.state.doc === before
          ? this.hovered
          : this.blocks.find((block) => block.from === plan.movedFrom) ?? null)
      : null;
    this.focusHandleAfterLayout = fromHandle;
    if (fromHandle && this.hovered) {
      // Keep consecutive key events on this control while layout catches up.
      this.handle.hidden = false;
      this.handle.focus({ preventScroll: true });
    } else if (!fromHandle) {
      this.view.focus();
    }
    this.announce(this.view.state.doc !== before);
    this.measure();
  }

  private announce(success: boolean): void {
    this.status.textContent = success
      ? this.options.movedMessage ?? "Block moved"
      : this.options.blockedMessage ?? "Block could not be moved";
  }

  private cancel(): void {
    const pointerId = this.gesture?.pointerId;
    this.gesture = null;
    if (this.frame !== null) this.ownerWindow.cancelAnimationFrame(this.frame);
    this.frame = null;
    if (pointerId !== undefined && this.handle.hasPointerCapture?.(pointerId)) {
      this.handle.releasePointerCapture(pointerId);
    }
    this.overlay.classList.remove("is-dragging");
    this.highlight.hidden = this.indicator.hidden = true;
  }

  private plan(source: number, gap: number): BlockMove | null {
    if (gap < 0 || gap > this.blocks.length) return null;
    const position = this.blocks[gap]?.from ?? this.view.state.doc.length;
    let hidden = false;
    foldedRanges(this.view.state).between(position, position, (from, to) => {
      if (from < position && position <= to) hidden = true;
    });
    return hidden ? null : planBlockMove(this.view.state, this.blocks, source, gap);
  }

  private bounds(block: MarkdownBlock): { top: number; bottom: number } {
    return {
      top: this.view.documentTop + this.view.lineBlockAt(block.from).top * this.view.scaleY,
      bottom: this.view.documentTop + this.view.lineBlockAt(block.to).bottom * this.view.scaleY,
    };
  }

  private gapAt(point: Point): number {
    const viewport = this.view.scrollDOM.getBoundingClientRect();
    if (
      point.x < viewport.left || point.x > viewport.right ||
      point.y < viewport.top || point.y > viewport.bottom
    ) return -1;
    const position = this.view.lineBlockAtHeight(
      Math.max(0, (point.y - this.view.documentTop) / this.view.scaleY),
    ).from;
    const index = this.blocks.findIndex((block) => block.to >= position);
    if (index < 0) return this.blocks.length;
    const bounds = this.bounds(this.blocks[index]);
    return point.y < (bounds.top + bounds.bottom) / 2 ? index : index + 1;
  }

  private measure(): void {
    if (this.stopped) return;
    this.view.requestMeasure<Layout>({
      key: this,
      read: () => {
        const root = this.view.dom.getBoundingClientRect();
        const scroll = this.view.scrollDOM.getBoundingClientRect();
        const content = this.view.contentDOM.getBoundingClientRect();
        let block: MarkdownBlock | null = null;
        let destination: number | null = null;
        if (this.gesture && this.point) {
          block = this.gesture.blocks[this.gesture.source];
          if (this.gesture.active) {
            const gap = this.gapAt(this.point);
            if (gap !== this.gesture.target) {
              this.gesture.target = gap;
              this.gesture.plan = this.plan(this.gesture.source, gap);
            }
            if (this.gesture.plan) {
              destination = gap === this.blocks.length
                ? this.bounds(this.blocks[gap - 1]).bottom
                : this.bounds(this.blocks[gap]).top;
            }
          }
        } else if (this.hovered && (this.focusHandleAfterLayout || this.ownerDocument.activeElement === this.handle)) {
          block = this.hovered;
        } else if (this.point && this.point.y >= scroll.top && this.point.y <= scroll.bottom) {
          const position = this.view.lineBlockAtHeight(
            Math.max(0, (this.point.y - this.view.documentTop) / this.view.scaleY),
          ).from;
          block = this.blocks.find((candidate) =>
            candidate.from <= position && position <= candidate.to,
          ) ?? null;
        } else if (this.view.hasFocus) {
          block = this.blocks[this.currentIndex()] ?? null;
        }
        if (block && !this.visibleBlock(block)) block = null;
        return {
          root,
          scroll,
          content,
          scrollLeft: this.view.scrollDOM.scrollLeft,
          block,
          source: block ? this.bounds(block) : null,
          destination,
        };
      },
      write: (layout) => this.draw(layout),
    });
  }

  private draw({ root, scroll, content, scrollLeft, source, block, destination }: Layout): void {
    if (this.stopped) return;
    this.hovered = block;
    const visible = source !== null && source.bottom > scroll.top && source.top < scroll.bottom;
    this.handle.hidden = !visible;
    const rtl = this.view.textDirection === Direction.RTL;
    // Keep the control beside the viewport when long source lines scroll.
    const offset = scrollLeft * this.view.scaleX;
    const contentLeft = Math.max(scroll.left, content.left + (rtl ? 0 : offset));
    const contentRight = Math.min(scroll.right, content.right + (rtl ? offset : 0));
    const x = rtl
      ? contentRight - (HANDLE_WIDTH + HANDLE_INSET) * this.view.scaleX
      : contentLeft + HANDLE_INSET * this.view.scaleX;
    if (visible && source) {
      this.handle.style.left = `${(x - root.left) / this.view.scaleX}px`;
      this.handle.style.top = `${(Math.max(source.top, scroll.top) - root.top) / this.view.scaleY}px`;
    }
    if (visible && this.focusHandleAfterLayout) {
      this.focusHandleAfterLayout = false;
      this.handle.focus({ preventScroll: true });
    }
    const left = (contentLeft - root.left) / this.view.scaleX + (rtl ? 0 : GUTTER_WIDTH);
    const width = Math.max(
      0,
      (contentRight - contentLeft) / this.view.scaleX - GUTTER_WIDTH,
    );
    this.highlight.hidden = !this.gesture?.active || !visible;
    if (source) {
      Object.assign(this.highlight.style, {
        left: `${left}px`,
        width: `${width}px`,
        top: `${(Math.max(source.top, scroll.top) - root.top) / this.view.scaleY}px`,
        height: `${Math.max(
          0,
          Math.min(source.bottom, scroll.bottom) - Math.max(source.top, scroll.top),
        ) / this.view.scaleY}px`,
      });
    }
    this.indicator.hidden = destination === null ||
      destination < scroll.top || destination > scroll.bottom;
    if (destination !== null) {
      Object.assign(this.indicator.style, {
        left: `${left}px`,
        width: `${width}px`,
        top: `${(destination - root.top) / this.view.scaleY}px`,
      });
    }
  }

  private readonly scroll = (): void => {
    if (!this.gesture?.active || !this.point) return;
    const rect = this.view.scrollDOM.getBoundingClientRect();
    if (this.point.x >= rect.left && this.point.x <= rect.right) {
      const band = Math.min(AUTO_SCROLL_EDGE, rect.height / 4);
      const delta = this.point.y < rect.top + band
        ? this.point.y - rect.top - band
        : this.point.y > rect.bottom - band
          ? this.point.y - rect.bottom + band
          : 0;
      this.view.scrollDOM.scrollTop += Math.max(
        -AUTO_SCROLL_MAX_STEP,
        Math.min(AUTO_SCROLL_MAX_STEP, delta / 3),
      );
      if (delta) this.measure();
    }
    this.frame = this.ownerWindow.requestAnimationFrame(this.scroll);
  };
}

const theme = EditorView.baseTheme({
  ".cm-content[data-block-reorder]": { paddingInlineStart: `${GUTTER_WIDTH}px` },
  ".nexus-block-drag": {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "40",
  },
  ".nexus-block-drag [hidden], .nexus-block-drag[hidden]": { display: "none" },
  ".nexus-block-drag-handle": {
    position: "absolute",
    width: `${HANDLE_WIDTH}px`,
    height: `${HANDLE_HEIGHT}px`,
    padding: "0",
    border: "none",
    borderRadius: "4px",
    color: "var(--nexus-text-muted, #666)",
    background: "transparent",
    fontSize: "20px",
    lineHeight: `${HANDLE_HEIGHT}px`,
    cursor: "grab",
    pointerEvents: "auto",
  },
  ".nexus-block-drag-handle:hover": { background: "var(--nexus-bg-muted, #e8e8e8)" },
  ".nexus-block-drag-handle:focus-visible": {
    outline: "2px solid var(--nexus-accent, #7054c5)",
    outlineOffset: "-2px",
  },
  ".is-dragging .nexus-block-drag-handle": { cursor: "grabbing" },
  ".nexus-block-drag-highlight": {
    position: "absolute",
    background: "color-mix(in srgb, var(--nexus-accent, #7054c5) 10%, transparent)",
  },
  ".nexus-block-drag-indicator": {
    position: "absolute",
    height: "2px",
    background: "var(--nexus-accent, #7054c5)",
  },
  ".nexus-block-drag-status": {
    position: "absolute",
    width: "1px",
    height: "1px",
    overflow: "hidden",
    clipPath: "inset(50%)",
  },
});

export function createBlockDragExtension(options: BlockDragOptions = {}): Extension {
  const extension = ViewPlugin.define((view) => new BlockDragController(view, options));
  return [
    extension,
    theme,
    EditorView.contentAttributes.of({ "data-block-reorder": "" }),
    options.keyboard === false ? [] : keymap.of([
      { key: "Alt-Shift-ArrowUp", run: (view) => moveBlock(view, -1) },
      { key: "Alt-Shift-ArrowDown", run: (view) => moveBlock(view, 1) },
    ]),
  ];
}

export function canMoveBlock(view: EditorView, direction: -1 | 1): boolean {
  return controllers.get(view)?.canMove(direction) ?? false;
}

export function moveBlock(view: EditorView, direction: -1 | 1): boolean {
  return controllers.get(view)?.move(direction) ?? false;
}

export function stopBlockDrag(view: EditorView): void {
  controllers.get(view)?.stop();
}
