import {
  Facet,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  Transaction,
  type ChangeSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type Command,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  editorTransactionOrigin,
  type NexusPlugin,
} from "@floatboat/nexus-core";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

export const COLLABORATION_REMOTE_ORIGIN = "collab:remote";
export const COLLABORATION_INITIALIZE_ORIGIN = "collab:initialize";
export const COLLABORATION_AWARENESS_FIELD = "nexusCollaboration";

export interface CollaborationUser {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

export interface CollaborationOptions {
  readonly doc: Y.Doc;
  readonly field?: string;
  readonly awareness?: Awareness;
  readonly user?: CollaborationUser;
  /** Group adjacent local edits into one Yjs undo item. Default: 500ms. */
  readonly captureTimeout?: number;
  /** Install Mod-Z / Mod-Shift-Z collaboration key bindings. Default: true. */
  readonly historyKeymap?: boolean;
}

interface ResolvedCollaborationOptions {
  readonly doc: Y.Doc;
  readonly text: Y.Text;
  readonly awareness?: Awareness;
  readonly user?: CollaborationUser;
  readonly captureTimeout: number;
  readonly historyKeymap: boolean;
}

interface EncodedSelection {
  /** JSON-safe Yjs relative position bytes for Awareness transports. */
  readonly anchor: readonly number[];
  readonly head: readonly number[];
}

interface AwarenessPayload {
  readonly user?: CollaborationUser;
  readonly selection?: EncodedSelection;
}

interface BindingStatus {
  readonly destroyed: boolean;
  readonly undoDepth: number;
  readonly redoDepth: number;
}

const collaborationOptions = Facet.define<ResolvedCollaborationOptions, ResolvedCollaborationOptions | null>({
  combine(values) {
    if (values.length > 1) throw new Error("Only one Nexus collaboration configuration is allowed per editor");
    return values[0] ?? null;
  },
});

const replaceRemoteDecorations = StateEffect.define<DecorationSet>();

const remoteDecorations = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(replaceRemoteDecorations)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Y.UndoManager is the single history authority while collaboration is active.
// Keeping the same edits in CM history would let a second Mod-Z undo them twice.
const excludeCollaborativeChangesFromCodeMirrorHistory = EditorState.transactionExtender.of(
  (transaction) => transaction.docChanged
    ? { annotations: Transaction.addToHistory.of(false) }
    : null,
);

function normalizeColor(value: string | undefined, clientId: number): string {
  if (value && value.length <= 64 && /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^;{}]+\)|[a-z]+)$/i.test(value.trim())) {
    return value.trim();
  }
  const palette = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#d97706", "#0891b2"];
  return palette[Math.abs(clientId) % palette.length]!;
}

class RemoteCaretWidget extends WidgetType {
  constructor(
    private readonly clientId: number,
    private readonly name: string,
    private readonly color: string,
  ) {
    super();
  }

  eq(other: RemoteCaretWidget): boolean {
    return this.clientId === other.clientId && this.name === other.name && this.color === other.color;
  }

  toDOM(): HTMLElement {
    const caret = document.createElement("span");
    caret.className = "nexus-collab-caret";
    caret.dataset.collaborationClient = String(this.clientId);
    caret.style.borderColor = this.color;

    const label = document.createElement("span");
    label.className = "nexus-collab-caret-label";
    label.style.backgroundColor = this.color;
    label.textContent = this.name;
    caret.appendChild(label);
    return caret;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function decodeRelativePosition(value: unknown): Y.RelativePosition | null {
  try {
    if (value instanceof Uint8Array) return Y.decodeRelativePosition(value);
    if (Array.isArray(value) && value.every((part) =>
      Number.isInteger(part) && part >= 0 && part <= 255
    )) {
      return Y.decodeRelativePosition(Uint8Array.from(value));
    }
  } catch {
    // Malformed awareness is untrusted, ephemeral input.
  }
  return null;
}

function selectionIndex(
  encoded: unknown,
  doc: Y.Doc,
  text: Y.Text,
): number | null {
  const relative = decodeRelativePosition(encoded);
  if (!relative) return null;
  const absolute = Y.createAbsolutePositionFromRelativePosition(relative, doc);
  if (!absolute || absolute.type !== text) return null;
  return absolute.index;
}

function changesFromYTextDelta(delta: readonly { insert?: unknown; delete?: number; retain?: number }[]): ChangeSpec[] {
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  let oldPosition = 0;

  const append = (from: number, to: number, insert: string): void => {
    const previous = changes[changes.length - 1];
    if (previous && previous.from === from && (previous.to === from || to === from)) {
      previous.to = Math.max(previous.to, to);
      previous.insert += insert;
      return;
    }
    changes.push({ from, to, insert });
  };

  for (const operation of delta) {
    if (operation.retain) oldPosition += operation.retain;
    if (typeof operation.insert === "string" && operation.insert.length > 0) {
      append(oldPosition, oldPosition, operation.insert);
    }
    if (operation.delete && operation.delete > 0) {
      append(oldPosition, oldPosition + operation.delete, "");
      oldPosition += operation.delete;
    }
  }

  return changes;
}

class CollaborationBinding {
  readonly undoManager: Y.UndoManager;
  private readonly localOrigin = Object.freeze({ kind: "nexus-collaboration-local" });
  private destroyed = false;
  private initializationQueued = true;
  private awarenessRefreshQueued = false;

  constructor(
    private readonly view: EditorView,
    private readonly options: ResolvedCollaborationOptions,
  ) {
    this.undoManager = new Y.UndoManager(options.text, {
      captureTimeout: options.captureTimeout,
      trackedOrigins: new Set([this.localOrigin]),
    });
    options.text.observe(this.onSharedTextChange);
    options.awareness?.on("change", this.onAwarenessChange);

    queueMicrotask(() => {
      if (this.destroyed) return;
      this.initializationQueued = false;
      const shared = options.text.toString();
      if (this.view.state.doc.toString() !== shared) {
        this.view.dispatch({
          changes: { from: 0, to: this.view.state.doc.length, insert: shared },
          annotations: [
            editorTransactionOrigin.of([COLLABORATION_INITIALIZE_ORIGIN]),
            Transaction.addToHistory.of(false),
          ],
        });
      }
      this.publishLocalSelection();
      this.queueRemoteDecorationsRefresh();
    });
  }

  update(update: ViewUpdate): void {
    if (this.destroyed) return;

    const isCollaborationDispatch = update.transactions.some((transaction) => {
      const origins = transaction.annotation(editorTransactionOrigin);
      return origins?.includes(COLLABORATION_REMOTE_ORIGIN) ||
        origins?.includes(COLLABORATION_INITIALIZE_ORIGIN);
    });

    if (update.docChanged && !isCollaborationDispatch && !this.initializationQueued) {
      const edits: Array<{ from: number; to: number; insert: string }> = [];
      update.changes.iterChanges((from, to, _fromAfter, _toAfter, inserted) => {
        edits.push({ from, to, insert: inserted.toString() });
      });

      this.options.doc.transact(() => {
        for (const edit of edits.sort((left, right) => right.from - left.from || right.to - left.to)) {
          if (edit.to > edit.from) this.options.text.delete(edit.from, edit.to - edit.from);
          if (edit.insert.length > 0) this.options.text.insert(edit.from, edit.insert);
        }
      }, this.localOrigin);
    }

    if (update.selectionSet || update.docChanged) this.publishLocalSelection();
  }

  undo(): boolean {
    if (this.destroyed || this.undoManager.undoStack.length === 0) return false;
    this.undoManager.undo();
    return true;
  }

  redo(): boolean {
    if (this.destroyed || this.undoManager.redoStack.length === 0) return false;
    this.undoManager.redo();
    return true;
  }

  status(): BindingStatus {
    return Object.freeze({
      destroyed: this.destroyed,
      undoDepth: this.undoManager.undoStack.length,
      redoDepth: this.undoManager.redoStack.length,
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.options.text.unobserve(this.onSharedTextChange);
    this.options.awareness?.off("change", this.onAwarenessChange);
    this.options.awareness?.setLocalStateField(COLLABORATION_AWARENESS_FIELD, null);
    this.undoManager.destroy();
  }

  private readonly onSharedTextChange = (
    event: Y.YTextEvent,
    transaction: Y.Transaction,
  ): void => {
    if (this.destroyed || transaction.origin === this.localOrigin) return;
    const changes = changesFromYTextDelta(event.delta);
    if (changes.length === 0) return;
    this.view.dispatch({
      changes,
      annotations: [
        editorTransactionOrigin.of([COLLABORATION_REMOTE_ORIGIN]),
        Transaction.addToHistory.of(false),
      ],
    });
  };

  private readonly onAwarenessChange = (): void => {
    this.queueRemoteDecorationsRefresh();
  };

  private queueRemoteDecorationsRefresh(): void {
    if (this.destroyed || this.awarenessRefreshQueued) return;
    this.awarenessRefreshQueued = true;
    queueMicrotask(() => {
      this.awarenessRefreshQueued = false;
      if (!this.destroyed) this.refreshRemoteDecorations();
    });
  }

  private publishLocalSelection(): void {
    const awareness = this.options.awareness;
    if (!awareness || this.destroyed) return;
    const selection = this.view.state.selection.main;
    const payload: AwarenessPayload = {
      user: this.options.user,
      selection: {
        anchor: Array.from(Y.encodeRelativePosition(
          Y.createRelativePositionFromTypeIndex(this.options.text, selection.anchor),
        )),
        head: Array.from(Y.encodeRelativePosition(
          Y.createRelativePositionFromTypeIndex(this.options.text, selection.head),
        )),
      },
    };
    awareness.setLocalStateField(COLLABORATION_AWARENESS_FIELD, payload);
  }

  private refreshRemoteDecorations(): void {
    const awareness = this.options.awareness;
    if (!awareness || this.destroyed) return;
    const ranges: Array<ReturnType<Decoration["range"]>> = [];

    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID || !state || typeof state !== "object") continue;
      const payload = (state as Record<string, unknown>)[COLLABORATION_AWARENESS_FIELD] as
        | AwarenessPayload
        | undefined;
      if (!payload?.selection) continue;
      const anchor = selectionIndex(payload.selection.anchor, this.options.doc, this.options.text);
      const head = selectionIndex(payload.selection.head, this.options.doc, this.options.text);
      if (anchor === null || head === null) continue;
      if (anchor < 0 || head < 0 || anchor > this.view.state.doc.length || head > this.view.state.doc.length) {
        continue;
      }

      const color = normalizeColor(
        typeof payload.user?.color === "string" ? payload.user.color : undefined,
        clientId,
      );
      const suppliedName = typeof payload.user?.name === "string" ? payload.user.name.trim() : "";
      const name = suppliedName.slice(0, 80) || `User ${clientId}`;
      const from = Math.min(anchor, head);
      const to = Math.max(anchor, head);
      if (from < to) {
        ranges.push(Decoration.mark({
          class: "nexus-collab-selection",
          attributes: {
            "data-collaboration-client": String(clientId),
            style: `background-color:color-mix(in srgb, ${color} 24%, transparent)`,
          },
        }).range(from, to));
      }
      ranges.push(Decoration.widget({
        widget: new RemoteCaretWidget(clientId, name, color),
        side: head === from ? -1 : 1,
      }).range(head));
    }

    this.view.dispatch({
      effects: replaceRemoteDecorations.of(Decoration.set(ranges, true)),
      annotations: Transaction.addToHistory.of(false),
    });
  }
}

const collaborationViewPlugin = ViewPlugin.fromClass(class {
  readonly binding: CollaborationBinding;

  constructor(view: EditorView) {
    const options = view.state.facet(collaborationOptions);
    if (!options) throw new Error("Nexus collaboration configuration is missing");
    this.binding = new CollaborationBinding(view, options);
  }

  update(update: ViewUpdate): void {
    this.binding.update(update);
  }

  destroy(): void {
    this.binding.destroy();
  }
});

function currentBinding(view: EditorView): CollaborationBinding | null {
  return view.plugin(collaborationViewPlugin)?.binding ?? null;
}

export const collaborationUndo: Command = (view) => currentBinding(view)?.undo() ?? false;
export const collaborationRedo: Command = (view) => currentBinding(view)?.redo() ?? false;

/** Return binding state for diagnostics and deterministic lifecycle tests. */
export function getCollaborationBindingStatus(view: EditorView): BindingStatus | null {
  return currentBinding(view)?.status() ?? null;
}

export function seedCollaborationDocument(
  doc: Y.Doc,
  markdown: string,
  field = "content",
): boolean {
  const text = doc.getText(field);
  if (text.length > 0) return false;
  if (markdown.length === 0) return true;
  doc.transact(() => text.insert(0, markdown), COLLABORATION_INITIALIZE_ORIGIN);
  return true;
}

export function createCollaborationPlugin(options: CollaborationOptions): NexusPlugin {
  const field = options.field?.trim() || "content";
  const captureTimeout = options.captureTimeout ?? 500;
  if (!Number.isFinite(captureTimeout) || captureTimeout < 0) {
    throw new RangeError("captureTimeout must be a non-negative finite number");
  }
  const resolved: ResolvedCollaborationOptions = Object.freeze({
    doc: options.doc,
    text: options.doc.getText(field),
    awareness: options.awareness,
    user: options.user ? Object.freeze({ ...options.user }) : undefined,
    captureTimeout,
    historyKeymap: options.historyKeymap !== false,
  });

  return {
    name: "plugin-collab",
    cmExtensions: [
      collaborationOptions.of(resolved),
      excludeCollaborativeChangesFromCodeMirrorHistory,
      remoteDecorations,
      collaborationViewPlugin,
      EditorView.baseTheme({
        ".nexus-collab-selection": {
          borderRadius: "2px",
        },
        ".nexus-collab-caret": {
          borderLeft: "2px solid",
          height: "1.25em",
          marginLeft: "-1px",
          pointerEvents: "none",
          position: "relative",
        },
        ".nexus-collab-caret-label": {
          borderRadius: "3px 3px 3px 0",
          color: "white",
          fontFamily: "system-ui, sans-serif",
          fontSize: "10px",
          left: "-2px",
          lineHeight: "1.4",
          padding: "1px 4px",
          position: "absolute",
          top: "-1.35em",
          whiteSpace: "nowrap",
          zIndex: "20",
        },
      }),
      ...(resolved.historyKeymap
        ? [Prec.highest(keymap.of([
            { key: "Mod-z", run: collaborationUndo },
            { key: "Mod-Shift-z", run: collaborationRedo },
            { key: "Mod-y", run: collaborationRedo },
          ]))]
        : []),
    ],
  };
}

export type { Awareness } from "y-protocols/awareness";
export { Y };
