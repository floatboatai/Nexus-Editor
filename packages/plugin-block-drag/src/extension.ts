import { isolateHistory } from "@codemirror/commands";
import { foldedRanges } from "@codemirror/language";
import { type Extension, type Text } from "@codemirror/state";
import { Direction, EditorView, ViewPlugin, keymap, type ViewUpdate } from "@codemirror/view";
import { editorTransactionOrigin } from "@floatboat/nexus-core";
import { planBlockMove, readBlocks, type BlockMove, type MarkdownBlock } from "./move";

export interface BlockDragOptions {
  /** Accessible handle label and tooltip. Keyboard shortcuts are appended. */
  label?: string;
  movedAnnouncement?: string;
  unavailableAnnouncement?: string;
}

interface Point { x: number; y: number }
interface PendingDrag { pointerId: number; from: number; start: Point }
interface Drag {
  pointerId: number;
  start: Point;
  doc: Text;
  blocks: readonly MarkdownBlock[];
  source: number;
  active: boolean;
  target: number;
  move: BlockMove | null;
}
interface BlockRect { top: number; bottom: number }
interface Measurement {
  root: DOMRect;
  scroll: DOMRect;
  content: DOMRect;
  block: MarkdownBlock | null;
  rect: BlockRect | null;
  line: number | null;
}

export class BlockDragView {
  private readonly document: Document;
  private readonly window: Window;
  private readonly layer: HTMLDivElement;
  private readonly handle: HTMLButtonElement;
  private readonly outline: HTMLDivElement;
  private readonly line: HTMLDivElement;
  private readonly preview: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly cleanups: Array<() => void> = [];
  private blocks: MarkdownBlock[];
  private hover: MarkdownBlock | null = null;
  private pointer: Point | null = null;
  private pending: PendingDrag | null = null;
  private drag: Drag | null = null;
  private scrollFrame = 0;
  private stopped = false;

  constructor(
    private readonly view: EditorView,
    private readonly options: Required<BlockDragOptions>,
    private readonly instances: Set<BlockDragView>,
  ) {
    this.document = view.dom.ownerDocument;
    this.window = this.document.defaultView!;
    this.blocks = readBlocks(view.state);
    this.layer = this.element("nexus-block-drag-layer");
    this.handle = this.document.createElement("button");
    this.handle.type = "button";
    this.handle.className = "nexus-block-drag-handle";
    this.handle.textContent = "⠿";
    this.handle.title = `${options.label} · Alt+Shift+↑/↓`;
    this.handle.setAttribute("aria-label", this.handle.title);
    this.handle.setAttribute("aria-keyshortcuts", "Alt+Shift+ArrowUp Alt+Shift+ArrowDown");
    this.handle.hidden = true;
    this.outline = this.element("nexus-block-drag-outline");
    this.line = this.element("nexus-block-drag-line");
    this.preview = this.element("nexus-block-drag-preview");
    this.status = this.element("nexus-block-drag-status");
    this.status.setAttribute("role", "status");
    this.layer.append(this.handle, this.outline, this.line, this.preview, this.status);
    view.dom.append(this.layer);
    this.listen(view.dom, "pointermove", this.onHover as EventListener);
    this.listen(view.dom, "pointerleave", () => {
      if (this.drag || this.pending || this.document.activeElement === this.handle) return;
      this.pointer = null;
      this.hover = null;
      this.measure();
    });
    this.listen(this.handle, "pointerdown", this.onPointerDown as EventListener);
    // Prevent the compatibility mousedown from moving the CM selection/focus.
    this.listen(this.handle, "mousedown", (event) => event.preventDefault());
    this.listen(this.handle, "keydown", this.onHandleKey as EventListener);
    this.listen(this.handle, "blur", () => this.measure());
    this.listen(view.scrollDOM, "scroll", () => this.measure());
    this.listen(this.window, "resize", () => this.measure());
    this.listen(this.window, "pointermove", this.onDragMove as EventListener);
    this.listen(this.window, "pointerup", this.onPointerUp as EventListener);
    this.listen(this.window, "pointercancel", () => this.cancel());
    this.listen(this.handle, "lostpointercapture", () => this.cancel());
    this.listen(this.window, "blur", () => this.cancel());
    this.listen(this.window, "keydown", ((event: KeyboardEvent) => {
      if (event.key === "Escape" && (this.drag || this.pending)) {
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
      }
    }) as EventListener, true);
    instances.add(this);
    this.measure();
  }

  update(update: ViewUpdate): void {
    if (this.stopped) return;
    if (update.docChanged) {
      if (this.drag) this.cancel();
      if (this.pending) this.pending.from = update.changes.mapPos(this.pending.from);
      this.blocks = readBlocks(update.state);
    }
    if (update.state.readOnly || this.view.composing) this.cancel();
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || update.focusChanged) {
      this.measure();
    }
  }

  moveBy(direction: -1 | 1, fromHandle = false): boolean {
    if (this.stopped || this.view.state.readOnly || this.view.composing) return false;
    const active = this.document.activeElement;
    if (active !== this.view.contentDOM && active && this.view.contentDOM.contains(active)) return false;
    const pos = fromHandle && this.hover ? this.hover.from : this.view.state.selection.main.head;
    const index = this.blocks.findIndex((block) => pos >= block.from && pos <= block.to);
    if (index < 0 || !this.available(this.blocks[index])) return false;
    const spec = planBlockMove(this.view.state, this.blocks, index, direction < 0 ? index - 1 : index + 2);
    this.cancel();
    if (spec) this.commit(spec);
    else this.announce(this.options.unavailableAnnouncement);
    return true;
  }

  /** Logical stop runs before runtime waits for a safe physical reconfigure. */
  stop(): void {
    this.cancel();
    this.stopped = true;
    this.layer.hidden = true;
  }

  destroy(): void {
    this.stop();
    for (const cleanup of this.cleanups) cleanup();
    this.layer.remove();
    this.instances.delete(this);
  }

  private element(className: string): HTMLDivElement {
    const element = this.document.createElement("div");
    element.className = className;
    return element;
  }

  private listen(target: EventTarget, type: string, listener: EventListener, capture = false): void {
    target.addEventListener(type, listener, capture);
    this.cleanups.push(() => target.removeEventListener(type, listener, capture));
  }

  private available(block: MarkdownBlock): boolean {
    if (!block.movable || this.view.state.readOnly || this.view.composing) return false;
    let folded = false;
    foldedRanges(this.view.state).between(block.from, Math.min(this.view.state.doc.length, block.to + 1), (from) => {
      if (from <= block.from || /Heading/.test(block.type)) folded = true;
    });
    return !folded;
  }

  private readonly onHover = (event: PointerEvent): void => {
    if (this.stopped || event.pointerType === "touch" || this.drag || this.pending) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (event.target !== this.handle) this.measure();
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.stopped || event.button !== 0 || event.pointerType === "touch" || !this.hover || !this.available(this.hover)) return;
    event.preventDefault();
    this.cancel();
    const pending = this.pending = {
      pointerId: event.pointerId,
      from: this.hover.from,
      start: { x: event.clientX, y: event.clientY },
    };
    this.pointer = pending.start;
    this.handle.setPointerCapture(event.pointerId);
    // Table blur commits dirty cells in a microtask. Arm only after that commit,
    // mapping the intended block through any changes made during preparation.
    const active = this.document.activeElement as HTMLElement | null;
    if (active && active !== this.view.contentDOM && this.view.contentDOM.contains(active)) active.blur();
    queueMicrotask(() => {
      if (this.stopped || this.pending !== pending) return;
      this.pending = null;
      const source = this.blocks.findIndex((block) => block.from === pending.from);
      if (source < 0 || !this.available(this.blocks[source])) {
        this.cancel();
        return;
      }
      this.drag = { ...pending, source, doc: this.view.state.doc, blocks: this.blocks, active: false, target: -1, move: null };
    });
  };

  private readonly onDragMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if ((event.buttons & 1) === 0) {
      this.cancel();
      return;
    }
    event.preventDefault();
    this.pointer = { x: event.clientX, y: event.clientY };
    if (!drag.active && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) >= 5) {
      drag.active = true;
      this.layer.classList.add("is-dragging");
      const block = drag.blocks[drag.source];
      this.preview.textContent = this.view.state.doc.sliceString(block.from, block.to).trim().slice(0, 100);
      this.scrollFrame = this.window.requestAnimationFrame(this.autoScroll);
    }
    this.measure();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.pending?.pointerId === event.pointerId) {
      this.cancel();
      return;
    }
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.pointer = { x: event.clientX, y: event.clientY };
    // Mouseup may arrive before the last measurement frame. Resolve its actual
    // coordinates synchronously instead of committing the previous hover target.
    const target = this.targetAt(this.pointer);
    const move = drag.active && drag.doc === this.view.state.doc && !this.view.state.readOnly
      ? planBlockMove(this.view.state, drag.blocks, drag.source, target)
      : null;
    this.cancel();
    if (move) this.commit(move);
  };

  private readonly onHandleKey = (event: KeyboardEvent): void => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      this.moveBy(event.key === "ArrowUp" ? -1 : 1, true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      this.cancel();
      this.view.focus();
    }
  };

  private commit(spec: BlockMove): void {
    const before = this.view.state.doc;
    // createEditor routes native transactions through its public filter/update
    // pipeline. The full isolation annotation separates this move from typing.
    this.view.dispatch({
      changes: spec.changes,
      selection: spec.selection,
      userEvent: "move.block",
      annotations: [editorTransactionOrigin.of(["block-drag"]), isolateHistory.of("full")],
      // The cursor may be in another block. Keep the moved content visible
      // rather than jumping back to that unrelated cursor after a mouse drop.
      effects: EditorView.scrollIntoView(spec.movedFrom, { y: "nearest" }),
    });
    this.pointer = null;
    this.hover = null;
    this.view.focus();
    this.announce(before === this.view.state.doc ? this.options.unavailableAnnouncement : this.options.movedAnnouncement);
    this.measure();
  }

  private announce(message: string): void {
    this.status.textContent = message;
  }

  private cancel(): void {
    const pointerId = this.drag?.pointerId ?? this.pending?.pointerId;
    this.drag = null;
    this.pending = null;
    if (this.scrollFrame) this.window.cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    if (pointerId !== undefined && this.handle.hasPointerCapture(pointerId)) this.handle.releasePointerCapture(pointerId);
    this.layer.classList.remove("is-dragging");
    this.outline.hidden = this.line.hidden = this.preview.hidden = true;
    this.measure();
  }

  private rect(block: MarkdownBlock): BlockRect {
    return {
      top: this.view.documentTop + this.view.lineBlockAt(block.from).top * this.view.scaleY,
      bottom: this.view.documentTop + this.view.lineBlockAt(block.to).bottom * this.view.scaleY,
    };
  }

  private targetAt(point: Point): number {
    const scroll = this.view.scrollDOM.getBoundingClientRect();
    if (point.x < scroll.left || point.x > scroll.right || point.y < scroll.top || point.y > scroll.bottom) return -1;
    const pos = this.view.lineBlockAtHeight(Math.max(0, (point.y - this.view.documentTop) / this.view.scaleY)).from;
    const index = this.blocks.findIndex((block) => block.to >= pos);
    if (index < 0) return this.blocks.length;
    const rect = this.rect(this.blocks[index]);
    return point.y < (rect.top + rect.bottom) / 2 ? index : index + 1;
  }

  private measure(): void {
    if (this.stopped) return;
    this.view.requestMeasure<Measurement>({
      key: this,
      read: () => {
        const root = this.view.dom.getBoundingClientRect();
        const scroll = this.view.scrollDOM.getBoundingClientRect();
        const content = this.view.contentDOM.getBoundingClientRect();
        let block: MarkdownBlock | null = null;
        let line: number | null = null;
        if (this.drag?.active && this.pointer) {
          block = this.drag.blocks[this.drag.source];
          const target = this.targetAt(this.pointer);
          if (target !== this.drag.target) {
            this.drag.target = target;
            this.drag.move = planBlockMove(this.view.state, this.drag.blocks, this.drag.source, target);
          }
          if (this.drag.move) line = target === this.blocks.length
            ? this.rect(this.blocks[target - 1]).bottom
            : this.rect(this.blocks[target]).top;
        } else if (this.document.activeElement === this.handle && this.hover) {
          block = this.hover;
        } else if (this.pointer && this.pointer.y >= scroll.top && this.pointer.y <= scroll.bottom) {
          const pos = this.view.lineBlockAtHeight(Math.max(0, (this.pointer.y - this.view.documentTop) / this.view.scaleY)).from;
          block = this.blocks.find((candidate) => pos >= candidate.from && pos <= candidate.to) ?? null;
        } else if (this.view.hasFocus) {
          const pos = this.view.state.selection.main.head;
          block = this.blocks.find((candidate) => pos >= candidate.from && pos <= candidate.to) ?? null;
        }
        if (block && !this.available(block)) block = null;
        return { root, scroll, content, block, rect: block ? this.rect(block) : null, line };
      },
      write: (measurement) => this.render(measurement),
    });
  }

  private render({ root, scroll, content, block, rect, line }: Measurement): void {
    if (this.stopped) return;
    const visible = !!rect && rect.bottom > scroll.top && rect.top < scroll.bottom;
    const rtl = this.view.textDirection === Direction.RTL;
    this.handle.hidden = !visible;
    this.hover = block;
    if (visible && rect) {
      const handleLeft = rtl ? content.right - 26 * this.view.scaleX : content.left + 2 * this.view.scaleX;
      this.handle.style.left = `${(handleLeft - root.left) / this.view.scaleX}px`;
      this.handle.style.top = `${(Math.max(rect.top, scroll.top + 2) - root.top) / this.view.scaleY}px`;
    }
    const active = !!this.drag?.active;
    this.preview.hidden = !active;
    this.outline.hidden = !active || !visible;
    this.line.hidden = !active || line === null || line < scroll.top || line > scroll.bottom;
    const left = (content.left - root.left) / this.view.scaleX + (rtl ? 0 : 28);
    const right = (Math.min(content.right, scroll.right) - root.left) / this.view.scaleX - (rtl ? 28 : 0);
    const width = Math.max(0, right - left - 4);
    if (active && rect) {
      Object.assign(this.outline.style, {
        left: `${left}px`, width: `${width}px`,
        top: `${(Math.max(rect.top, scroll.top) - root.top) / this.view.scaleY}px`,
        height: `${Math.max(0, Math.min(rect.bottom, scroll.bottom) - Math.max(rect.top, scroll.top)) / this.view.scaleY}px`,
      });
    }
    if (line !== null) Object.assign(this.line.style, { left: `${left}px`, width: `${width}px`, top: `${(line - root.top) / this.view.scaleY}px` });
    if (active && this.pointer) Object.assign(this.preview.style, {
      left: `${Math.max(left, (Math.min(this.pointer.x + 14, scroll.right - 220) - root.left) / this.view.scaleX)}px`,
      top: `${(Math.min(this.pointer.y + 16, scroll.bottom - 42) - root.top) / this.view.scaleY}px`,
    });
  }

  private readonly autoScroll = (): void => {
    if (!this.drag?.active || !this.pointer) return;
    const rect = this.view.scrollDOM.getBoundingClientRect();
    if (this.pointer.x >= rect.left && this.pointer.x <= rect.right) {
      const edge = Math.min(48, rect.height / 4);
      const speed = this.pointer.y < rect.top + edge
        ? -Math.min(18, (rect.top + edge - this.pointer.y) / 3)
        : this.pointer.y > rect.bottom - edge ? Math.min(18, (this.pointer.y - rect.bottom + edge) / 3) : 0;
      if (speed) {
        this.view.scrollDOM.scrollTop += speed;
        this.measure();
      }
    }
    this.scrollFrame = this.window.requestAnimationFrame(this.autoScroll);
  };
}

const theme = EditorView.baseTheme({
  ".cm-content[data-block-drag]": { paddingInlineStart: "28px" },
  ".nexus-block-drag-layer": { position: "absolute", inset: "0", overflow: "hidden", pointerEvents: "none", zIndex: "40" },
  ".nexus-block-drag-layer [hidden], .nexus-block-drag-layer[hidden]": { display: "none" },
  ".nexus-block-drag-handle": {
    position: "absolute", width: "24px", height: "26px", padding: "0", border: "0", borderRadius: "5px",
    background: "transparent", color: "var(--nexus-text-muted)", fontSize: "22px", lineHeight: "26px", pointerEvents: "auto", cursor: "grab", touchAction: "pan-y",
  },
  ".nexus-block-drag-handle:hover, .nexus-block-drag-handle:focus-visible": { background: "var(--nexus-bg-muted)", color: "inherit" },
  ".nexus-block-drag-handle:focus-visible": { outline: "2px solid var(--nexus-accent)" },
  ".is-dragging .nexus-block-drag-handle": { cursor: "grabbing" },
  ".nexus-block-drag-outline": { position: "absolute", background: "color-mix(in srgb, var(--nexus-accent) 5%, transparent)", borderRadius: "3px" },
  ".nexus-block-drag-line": { position: "absolute", height: "2px", background: "var(--nexus-accent)" },
  ".nexus-block-drag-preview": {
    position: "absolute", maxWidth: "200px", padding: "8px 12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    background: "var(--nexus-bg-subtle)", color: "var(--nexus-text)", borderRadius: "6px", boxShadow: "0 3px 14px #0003", fontSize: "13px",
  },
  ".nexus-block-drag-status": { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clipPath: "inset(50%)" },
});

export function buildBlockDragExtension(options: BlockDragOptions, instances: Set<BlockDragView>): Extension {
  const resolved: Required<BlockDragOptions> = {
    label: "Drag to move", movedAnnouncement: "Block moved", unavailableAnnouncement: "Cannot move the block here", ...options,
  };
  const plugin = ViewPlugin.define((view) => new BlockDragView(view, resolved, instances));
  return [
    plugin, theme, EditorView.contentAttributes.of({ "data-block-drag": "" }),
    keymap.of([
      { key: "Alt-Shift-ArrowUp", run: (view) => view.plugin(plugin)?.moveBy(-1) ?? false },
      { key: "Alt-Shift-ArrowDown", run: (view) => view.plugin(plugin)?.moveBy(1) ?? false },
    ]),
  ];
}
