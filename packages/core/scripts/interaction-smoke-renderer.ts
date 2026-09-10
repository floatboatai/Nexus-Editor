import { createEditor, type EditorAPI, type AssetInputEvent } from "../src/index";
import { EditorView } from "@codemirror/view";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

const style = document.createElement("style");
style.textContent = "body{margin:0;padding:30px;background:#fff;font:14px sans-serif}#editor{height:470px;width:760px;border:1px solid #ddd;margin-top:24px}.cm-editor{height:100%}#outside{padding:10px 20px} .cm-content{font-family:monospace}";
document.head.append(style);
const outside = document.createElement("button");
outside.id = "outside";
outside.textContent = "Outside editor";
const container = document.createElement("div");
container.id = "editor";
document.body.append(outside, container);

let editor: EditorAPI | null = null;
let view: EditorView | null = null;
let events: AssetInputEvent[] = [];
let releases: Array<() => void> = [];
let releaseImmediately = false;
let uploadReference = "_assets/a.png";
let epoch = 0;
let nativeEvents: Record<string, unknown>[] = [];
let pointRequests: Array<{ x: number; y: number; selector: string; index: number; box: number[] }> = [];
let resetDiagnostics: Record<string, unknown> = {};
const documentListeners: Array<{ epoch: number; type: string; listener: EventListenerOrEventListenerObject; capture: boolean; active: boolean }> = [];
const originalAdd = document.addEventListener.bind(document);
const originalRemove = document.removeEventListener.bind(document);
const trackedTypes = new Set(["mousedown", "mousemove", "mouseup", "selectionchange"]);
document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
  if (!listener) return;
  const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
  if (listener && trackedTypes.has(type) && !documentListeners.some((entry) => entry.active && entry.type === type && entry.listener === listener && entry.capture === capture)) {
    documentListeners.push({ epoch, type, listener, capture, active: true });
  }
  originalAdd(type, listener, options);
}) as Document["addEventListener"];
document.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => {
  if (!listener) return;
  const capture = typeof options === "boolean" ? options : Boolean(options?.capture);
  for (const entry of documentListeners) if (entry.type === type && entry.listener === listener && entry.capture === capture) entry.active = false;
  originalRemove(type, listener, options);
}) as Document["removeEventListener"];
function identify(target: EventTarget | null): string {
  return target instanceof HTMLElement ? `${target.tagName}.${target.className}#${target.id}` : String(target);
}
for (const type of ["mousedown", "mousemove", "mouseup", "click", "focusin", "focusout", "selectionchange", "input"]) {
  originalAdd(type, (event) => {
    const mouse = event instanceof MouseEvent ? event : null;
    const entry: Record<string, unknown> = {
      time: Date.now(), type, epoch, trusted: event.isTrusted, target: identify(event.target),
      ...(mouse ? { x: mouse.clientX, y: mouse.clientY, buttons: mouse.buttons, button: mouse.button,
        hit: identify(document.elementFromPoint(mouse.clientX, mouse.clientY)) } : {}),
    };
    nativeEvents.push(entry);
    if (nativeEvents.length > 45) nativeEvents.shift();
    queueMicrotask(() => { entry.prevented = event.defaultPrevented; entry.activeAfter = identify(document.activeElement); });
  }, true);
}
const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const requireEditor = () => { if (!editor) throw new Error("Editor is not mounted"); return editor; };
const requireView = () => { if (!view) throw new Error("Editor view is not mounted"); return view; };
function element(selector: string, index = 0): HTMLElement {
  const found = document.querySelectorAll<HTMLElement>(selector)[index];
  if (!found) throw new Error(`Missing ${selector}[${index}]`);
  return found;
}
function point(selector: string, index = 0, horizontal = 0.5, vertical = 0.5) {
  const rect = element(selector, index).getBoundingClientRect();
  if (!rect.width || !rect.height) throw new Error(`Element has no rendered bounds: ${selector}[${index}]`);
  const coordinate = { x: Math.round(rect.left + rect.width * horizontal), y: Math.round(rect.top + rect.height * vertical) };
  pointRequests.push({ ...coordinate, selector, index, box: [rect.left, rect.top, rect.width, rect.height] });
  return coordinate;
}

function geometry(): number[][] {
  return Array.from(container.querySelectorAll(".nexus-cell, .nexus-col-grip, .cm-content"), (node) => {
    const rect = node.getBoundingClientRect();
    return [rect.left, rect.top, rect.width, rect.height].map((number) => Math.round(number * 100) / 100);
  });
}

async function stableLayout(): Promise<{ samples: number; geometry: number[][] }> {
  await document.fonts.ready;
  let previous = "", stable = 0;
  for (let samples = 1; samples <= 120; samples += 1) {
    await frame();
    const current = geometry();
    const signature = JSON.stringify(current);
    stable = signature === previous ? stable + 1 : 0;
    if (stable >= 3) return { samples, geometry: current };
    previous = signature;
  }
  throw new Error("Layout did not stabilize after 120 frames");
}
function transfer(kind: "paste" | "drop", coordinate?: { x: number; y: number }) {
  const data = new DataTransfer();
  data.items.add(new File([png], "a.png", { type: "image/png" }));
  const target = coordinate ? document.elementFromPoint(coordinate.x, coordinate.y) : document.activeElement;
  if (!(target instanceof HTMLElement)) throw new Error("Missing transfer target");
  const event = kind === "paste"
    ? new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true })
    : new DragEvent("drop", { dataTransfer: data, clientX: coordinate?.x, clientY: coordinate?.y, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return { prevented: event.defaultPrevented, target: target.className };
}

const api = {
  async reset(markdown: string, table = true) {
    const old = editor;
    const beforeDestroy = old?.getContributionSink().isInteractionActive() ?? false;
    editor?.destroy();
    const afterDestroy = old?.getContributionSink().isInteractionActive() ?? false;
    epoch += 1;
    nativeEvents = [];
    pointRequests = [];
    container.replaceChildren();
    const ownEvents: AssetInputEvent[] = [];
    events = ownEvents;
    releases = [];
    releaseImmediately = false;
    uploadReference = "_assets/a.png";
    editor = createEditor({
      container, initialValue: markdown, livePreview: table ? { enabled: true, assetProvider: { read: async () => ({ bytes: png, mimeType: "image/png" }) } } : false,
      plugins: [createGfmPreset(), createHistoryPlugin()],
      assetInput: { managed: true, onEvent: (event) => ownEvents.push(event) },
      onAssetUpload: async () => {
        if (!releaseImmediately) await new Promise<void>((resolve) => releases.push(resolve));
        return uploadReference;
      },
    });
    const root = container.querySelector<HTMLElement>(".cm-editor");
    view = root ? EditorView.findFromDOM(root) : null;
    resetDiagnostics = { beforeDestroy, afterDestroy, ...await stableLayout() };
    return api.state();
  },
  point,
  validatePoint(coordinate: { x: number; y: number }) {
    const requested = [...pointRequests].reverse().find((entry) => entry.x === coordinate.x && entry.y === coordinate.y);
    if (!requested) return;
    const target = element(requested.selector, requested.index);
    const actual = document.elementFromPoint(coordinate.x, coordinate.y);
    if (!actual || (actual !== target && !target.contains(actual))) {
      throw new Error(`Coordinate target changed: ${JSON.stringify({ requested, actual: identify(actual), geometry: geometry() })}`);
    }
  },
  validateMouseButtons(type: string, buttons: number) {
    const event = [...nativeEvents].reverse().find((entry) => entry.type === type);
    if (!event || event.buttons !== buttons) throw new Error(`Invalid native button state: ${JSON.stringify(event)}`);
  },
  positionPoint(position: number) {
    const rect = requireView().coordsAtPos(position);
    if (!rect) throw new Error("Position is not visible");
    const coordinate = { x: Math.round(rect.left), y: Math.round((rect.top + rect.bottom) / 2) };
    return { ...coordinate, position: requireView().posAtCoords(coordinate) };
  },
  selectDocument(anchor: number, head = anchor) { requireEditor().setSelection(anchor, head); requireEditor().focus(); },
  selectCellText(index: number) {
    const cell = element(".nexus-cell", index);
    if (document.activeElement !== cell || cell.contentEditable !== "true") throw new Error("Native click did not activate the cell");
    const range = document.createRange();
    range.selectNodeContents(cell);
    const selection = document.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
  },
  cellCaret(index: number, offset: number) {
    const cell = element(".nexus-cell", index);
    const text = cell.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error("Cell is not editing raw text");
    const range = document.createRange();
    range.setStart(text, offset); range.collapse(true);
    const selection = document.getSelection();
    selection?.removeAllRanges(); selection?.addRange(range);
  },
  paste: () => transfer("paste"),
  drop: (coordinate: { x: number; y: number }) => transfer("drop", coordinate),
  releaseUploads() { releaseImmediately = true; for (const release of releases.splice(0)) release(); },
  undo: () => requireEditor().undo(),
  capture: () => requireEditor().captureDocumentSnapshot(),
  normalizeUpload(prefix = false, structural = false) {
    uploadReference = "http://example.invalid/a.png";
    requireEditor().getContributionSink().registerTransactionFilter("smoke-normalize-upload", (context) => {
      if (context.userEvent !== "input.paste") return { action: "accept" };
      return {
        action: "replace",
        transaction: {
          origin: [],
          changes: context.changes.map((change) => ({
            ...change,
            insert: structural ? "Filter replaced the table with text" :
              (prefix ? "Inserted prefix\n\n" : "") + change.insert.replace("http://", "https://"),
          })),
        },
      };
    });
  },
  async normalizedRestore() {
    const current = requireEditor();
    if (!current.restoreDocumentBuffer || !current.getDocumentRevision) throw new Error("Restore API is unavailable");
    current.getContributionSink().registerTransactionFilter("smoke-normalize-pending", (context) => {
      if (!context.changes.some((change) => change.insert.includes("pending"))) return { action: "accept" };
      return {
        action: "replace",
        transaction: {
          origin: [],
          changes: context.changes.map((change) => ({ ...change, insert: change.insert.replace("pending", "normalized") })),
        },
      };
    });
    return current.restoreDocumentBuffer("Historical content", { expectedRevision: current.getDocumentRevision() });
  },
  async rejectedRestore() {
    const current = requireEditor();
    if (!current.restoreDocumentBuffer || !current.getDocumentRevision) throw new Error("Restore API is unavailable");
    current.getContributionSink().registerTransactionFilter("smoke-deny-restore", (transaction) =>
      transaction.userEvent === "input.restore" ? { action: "reject" } : { action: "accept" });
    return current.restoreDocumentBuffer("Historical content", { expectedRevision: current.getDocumentRevision() });
  },
  state() {
    const cells = Array.from(container.querySelectorAll<HTMLElement>(".nexus-cell"));
    return {
      markdown: requireEditor().getDocument(),
      events: events.map((event) => ({ ...event })),
      active: document.activeElement?.className ?? "",
      selected: cells.filter((cell) => cell.style.background.replace(/\s/g, "") === "rgba(124,108,250,0.12)").length,
      cells: cells.map((cell) => ({ text: cell.textContent, editable: cell.contentEditable })),
      headers: Array.from(container.querySelectorAll("th.nexus-cell"), (cell) => cell.textContent),
      body: Array.from(container.querySelectorAll("td.nexus-cell"), (cell) => cell.textContent),
      diagnostics: {
        epoch, reset: resetDiagnostics, geometry: geometry(), pointRequests, nativeEvents,
        documentFocused: document.hasFocus(), interactionActive: requireEditor().getContributionSink().isInteractionActive(),
        bodyCursor: document.body.style.cursor, bodyUserSelect: document.body.style.userSelect,
        selection: document.getSelection()?.toString(),
        documentListeners: documentListeners.filter((entry) => entry.active).map((entry) => ({
          epoch: entry.epoch, type: entry.type, capture: entry.capture,
          name: typeof entry.listener === "function" ? entry.listener.name : "object",
        })),
      },
    };
  },
  destroy() { editor?.destroy(); editor = null; view = null; },
};
(window as unknown as { coreInteractionSmoke: typeof api }).coreInteractionSmoke = api;
