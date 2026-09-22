import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Extension, type Text } from "@codemirror/state";

export interface BlockRange {
  from: number;
  to: number;
  lineStart: number;
  lineEnd: number;
}

export interface BlockDragOptions {
  /**
   * Distance in pixels from the left of the line where the handle appears.
   * Defaults to -26px.
   */
  handleOffsetPx?: number;
  /**
   * Custom callback fired after a block has been successfully moved.
   */
  onBlockMove?: (source: BlockRange, targetPos: number) => void;
}

/**
 * Finds the continuous Markdown block boundary (paragraph, heading,
 * table, code block, blockquote, or list item) containing `pos`.
 */
export function findBlockRange(doc: Text, pos: number): BlockRange {
  const currentLine = doc.lineAt(Math.max(0, Math.min(doc.length, pos)));
  const lineNum = currentLine.number;
  const lineText = currentLine.text;

  // 1. Fenced code block detection
  let inCode = false;
  let codeStartLine = -1;
  let codeEndLine = -1;
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n);
    if (/^```/.test(l.text.trimStart())) {
      if (!inCode) {
        inCode = true;
        codeStartLine = n;
      } else {
        inCode = false;
        codeEndLine = n;
        if (lineNum >= codeStartLine && lineNum <= codeEndLine) {
          return {
            from: doc.line(codeStartLine).from,
            to: Math.min(doc.length, doc.line(codeEndLine).to + 1),
            lineStart: codeStartLine,
            lineEnd: codeEndLine,
          };
        }
      }
    }
  }
  if (inCode && lineNum >= codeStartLine) {
    // Unclosed code block until end of doc
    return {
      from: doc.line(codeStartLine).from,
      to: doc.length,
      lineStart: codeStartLine,
      lineEnd: doc.lines,
    };
  }

  // 2. Heading (single-line ATX heading)
  if (/^#{1,6}\s/.test(lineText.trimStart())) {
    return {
      from: currentLine.from,
      to: Math.min(doc.length, currentLine.to + 1),
      lineStart: lineNum,
      lineEnd: lineNum,
    };
  }

  // 3. Table detection (lines with pipes)
  if (lineText.trim().startsWith("|") || lineText.trim().endsWith("|")) {
    let start = lineNum;
    while (start > 1) {
      const prev = doc.line(start - 1).text.trim();
      if (prev.startsWith("|") || prev.endsWith("|")) {
        start--;
      } else {
        break;
      }
    }
    let end = lineNum;
    while (end < doc.lines) {
      const next = doc.line(end + 1).text.trim();
      if (next.startsWith("|") || next.endsWith("|")) {
        end++;
      } else {
        break;
      }
    }
    return {
      from: doc.line(start).from,
      to: Math.min(doc.length, doc.line(end).to + 1),
      lineStart: start,
      lineEnd: end,
    };
  }

  // 4. Blank line (standalone)
  if (lineText.trim().length === 0) {
    return {
      from: currentLine.from,
      to: Math.min(doc.length, currentLine.to + 1),
      lineStart: lineNum,
      lineEnd: lineNum,
    };
  }

  // 5. General paragraph or list block (consecutive non-blank lines)
  let start = lineNum;
  while (start > 1 && doc.line(start - 1).text.trim().length > 0 && !/^#{1,6}\s/.test(doc.line(start - 1).text.trimStart())) {
    start--;
  }

  let end = lineNum;
  while (end < doc.lines && doc.line(end + 1).text.trim().length > 0 && !/^#{1,6}\s/.test(doc.line(end + 1).text.trimStart())) {
    end++;
  }

  return {
    from: doc.line(start).from,
    to: Math.min(doc.length, doc.line(end).to + 1),
    lineStart: start,
    lineEnd: end,
  };
}

/**
 * Creates an SVG 6-dot drag handle icon (⋮⋮).
 */
function createHandleIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 10 16");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "currentColor");
  svg.style.display = "block";

  for (let col = 0; col < 2; col++) {
    for (let row = 0; row < 3; row++) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(2 + col * 6));
      circle.setAttribute("cy", String(3 + row * 5));
      circle.setAttribute("r", "1.5");
      svg.appendChild(circle);
    }
  }
  return svg;
}

/**
 * ViewPlugin that provides the Notion-style hoverable and draggable block handle.
 */
class BlockDragViewPlugin {
  private readonly handle: HTMLElement;
  private readonly indicator: HTMLElement;
  private currentBlock: BlockRange | null = null;
  private isDragging = false;
  private targetLineNum: number | null = null;

  constructor(private readonly view: EditorView, private readonly options: BlockDragOptions = {}) {
    // 1. Create floating handle element
    this.handle = document.createElement("div");
    this.handle.className = "nexus-block-handle";
    this.handle.dataset.testId = "nexus-block-handle";
    this.handle.title = "Drag to move block, click to select";
    this.handle.style.cssText = `
      position: absolute;
      width: 18px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--nexus-text-muted, #9ca3af);
      cursor: grab;
      border-radius: 4px;
      z-index: 20;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s ease, background 0.15s ease;
      user-select: none;
    `;
    this.handle.appendChild(createHandleIcon());

    // 2. Create drop indicator line
    this.indicator = document.createElement("div");
    this.indicator.className = "nexus-drop-indicator";
    this.indicator.dataset.testId = "nexus-drop-indicator";
    this.indicator.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--nexus-accent, #0969da);
      z-index: 30;
      display: none;
      pointer-events: none;
      border-radius: 1px;
    `;

    view.dom.appendChild(this.handle);
    view.dom.appendChild(this.indicator);

    this.attachEvents();
  }

  private attachEvents(): void {
    const { dom } = this.view;

    dom.addEventListener("mousemove", this.onMouseMove);
    dom.addEventListener("mouseleave", this.onMouseLeave);
    this.handle.addEventListener("mouseenter", this.onHandleEnter);
    this.handle.addEventListener("mousedown", this.onHandleMouseDown);
    this.handle.addEventListener("click", this.onHandleClick);
  }

  private onMouseMove = (e: MouseEvent) => {
    if (this.isDragging) return;

    const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return;

    const block = findBlockRange(this.view.state.doc, pos);
    this.currentBlock = block;

    const lineCoords = this.view.coordsAtPos(block.from);
    if (!lineCoords) return;

    const domRect = this.view.dom.getBoundingClientRect();
    const offsetLeft = this.options.handleOffsetPx ?? 4;
    const top = lineCoords.top - domRect.top + (this.view.dom.scrollTop || 0);

    this.handle.style.left = `${offsetLeft}px`;
    this.handle.style.top = `${top}px`;
    this.handle.style.opacity = "1";
    this.handle.style.pointerEvents = "auto";
  };

  private onMouseLeave = () => {
    if (this.isDragging) return;
    this.handle.style.opacity = "0";
    this.handle.style.pointerEvents = "none";
  };

  private onHandleEnter = () => {
    this.handle.style.background = "var(--nexus-bg-subtle, #f3f4f6)";
    this.handle.style.color = "var(--nexus-text, #111827)";
  };

  private onHandleClick = (e: MouseEvent) => {
    if (this.isDragging || !this.currentBlock) return;
    e.preventDefault();
    e.stopPropagation();

    // Select entire block on click
    this.view.dispatch({
      selection: { anchor: this.currentBlock.from, head: this.currentBlock.to },
      scrollIntoView: true,
    });
    this.view.focus();
  };

  private onHandleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    if (!this.currentBlock) return;

    this.isDragging = true;
    this.handle.style.cursor = "grabbing";

    const sourceBlock = this.currentBlock;
    const doc = this.view.state.doc;

    const onWindowMouseMove = (moveEvent: MouseEvent) => {
      const pos = this.view.posAtCoords({ x: moveEvent.clientX, y: moveEvent.clientY });
      if (pos === null) {
        this.indicator.style.display = "none";
        this.targetLineNum = null;
        return;
      }

      const targetLine = doc.lineAt(pos);
      this.targetLineNum = targetLine.number;

      const coords = this.view.coordsAtPos(targetLine.from);
      if (coords) {
        const domRect = this.view.dom.getBoundingClientRect();
        const top = coords.top - domRect.top + (this.view.dom.scrollTop || 0);
        this.indicator.style.top = `${top}px`;
        this.indicator.style.display = "block";
      }
    };

    const onWindowMouseUp = () => {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);

      this.isDragging = false;
      this.handle.style.cursor = "grab";
      this.indicator.style.display = "none";

      if (this.targetLineNum !== null) {
        const targetLine = doc.line(this.targetLineNum);
        const targetPos = targetLine.from;

        // Perform move if target is outside source block
        if (targetPos < sourceBlock.from || targetPos > sourceBlock.to) {
          this.executeMoveBlock(sourceBlock, targetPos);
        }
      }
    };

    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
  };

  private executeMoveBlock(source: BlockRange, targetPos: number): void {
    const doc = this.view.state.doc;
    let blockText = doc.sliceString(source.from, source.to);
    if (!blockText.endsWith("\n")) {
      blockText += "\n";
    }

    if (targetPos < source.from) {
      // Moving block UP: insert before target, then delete old source
      this.view.dispatch({
        changes: [
          { from: targetPos, to: targetPos, insert: blockText },
          { from: source.from + blockText.length, to: source.to + blockText.length },
        ],
        selection: { anchor: targetPos },
        scrollIntoView: true,
      });
    } else {
      // Moving block DOWN: delete old source, then insert at target
      this.view.dispatch({
        changes: [
          { from: source.from, to: source.to },
          { from: targetPos, to: targetPos, insert: blockText },
        ],
        selection: { anchor: targetPos - (source.to - source.from) },
        scrollIntoView: true,
      });
    }

    this.options.onBlockMove?.(source, targetPos);
  }

  update(_update: ViewUpdate): void {
    // Re-check handle position if document changed
    if (this.currentBlock && this.handle.style.opacity === "1") {
      const maxLen = this.view.state.doc.length;
      if (this.currentBlock.from > maxLen) {
        this.handle.style.opacity = "0";
      }
    }
  }

  destroy(): void {
    const { dom } = this.view;
    dom.removeEventListener("mousemove", this.onMouseMove);
    dom.removeEventListener("mouseleave", this.onMouseLeave);
    this.handle.remove();
    this.indicator.remove();
  }
}

/**
 * Creates the CodeMirror 6 extension for Notion-style block hovering and drag-and-drop.
 */
export function blockDragExtension(options: BlockDragOptions = {}): Extension {
  return ViewPlugin.define((view) => new BlockDragViewPlugin(view, options));
}
