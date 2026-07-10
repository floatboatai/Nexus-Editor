import { EditorView, WidgetType } from "@codemirror/view";
import { acquireWidgetEditingLock, releaseWidgetEditingLock } from "./widget-state";
import type { WidgetContext, WidgetMeasureRequest } from "./widget-context";

/**
 * Lock reason discriminator for fine-grained lock tracking within a single
 * widget. A widget may hold multiple concurrent locks (e.g. "focus" +
 * "drag"). All locks are released when the widget is destroyed.
 */
export type WidgetLockReason = string;

/**
 * Lifecycle hooks that an {@link EditorWidget} subclass may override.
 * All hooks receive the widget's {@link WidgetContext} so they can
 * interact with the editor safely.
 */
export interface WidgetLifecycle {
  /** Called once after the widget's DOM is created and attached. */
  didMount?(ctx: WidgetContext): void;

  /** Called before the widget's DOM is about to be recreated (source changed). */
  willUpdate?(ctx: WidgetContext): void;

  /** Called after the widget's DOM was recreated due to a source change. */
  didUpdate?(ctx: WidgetContext): void;

  /** Called before the widget is destroyed. Release external resources here. */
  willDestroy?(ctx: WidgetContext): void;

  /** Called when the CM6 cursor enters this widget's document range. */
  activate?(ctx: WidgetContext): void;

  /** Called when the CM6 cursor leaves this widget's document range. */
  deactivate?(ctx: WidgetContext): void;
}

/**
 * Abstract base class for all Nexus editor widgets.
 *
 * Extends CodeMirror 6's {@link WidgetType} with:
 * - **Editing lock management** — prevents CM6 from destroying widget DOM
 *   during multi-frame interactions (drag, contentEditable, etc.)
 * - **Lifecycle hooks** — `didMount`, `willDestroy`, `activate`, `deactivate`
 * - **WidgetContext** — safe access to CM6 view, dispatch, coords
 * - **`eq()` default** — returns `true` while locks are held
 *
 * ## Usage
 *
 * ```ts
 * class MyWidget extends EditorWidget {
 *   get estimatedHeight(): number { return 48; }
 *
 *   protected buildDOM(): HTMLElement {
 *     const el = document.createElement("div");
 *     // ... build your widget DOM ...
 *     return el;
 *   }
 *
 *   didMount(ctx: WidgetContext): void {
 *     // Start rAF polling, attach document-level listeners, etc.
 *   }
 *
 *   willDestroy(ctx: WidgetContext): void {
 *     // Clean up listeners, timers, external resources
 *   }
 * }
 * ```
 */
export abstract class EditorWidget extends WidgetType implements WidgetLifecycle {
  /** The widget's context, set during {@link toDOM} and cleared on destroy. */
  protected ctx: WidgetContext | null = null;

  /** DOM element produced by {@link buildDOM}. Stored so subclasses can reference it. */
  protected dom: HTMLElement | null = null;

  /** Active lock reasons. When non-empty, `eq()` returns `true`. */
  private _activeLocks = new Set<WidgetLockReason>();

  // ── Lifecycle hooks (override in subclasses) ──

  /** @inheritdoc */
  didMount(_ctx: WidgetContext): void { /* noop */ }

  /** @inheritdoc */
  willUpdate(_ctx: WidgetContext): void { /* noop */ }

  /** @inheritdoc */
  didUpdate(_ctx: WidgetContext): void { /* noop */ }

  /** @inheritdoc */
  willDestroy(_ctx: WidgetContext): void { /* noop */ }

  /** @inheritdoc */
  activate(_ctx: WidgetContext): void { /* noop */ }

  /** @inheritdoc */
  deactivate(_ctx: WidgetContext): void { /* noop */ }

  // ── Subclass contract ──

  /**
   * Build the widget's DOM tree. Called from {@link toDOM} after the
   * context is set up. Subclasses MUST implement this — this is where
   * the actual widget UI is constructed.
   */
  protected abstract buildDOM(): HTMLElement;

  /**
   * Estimated height of the widget in pixels. CM6 uses this to initialise
   * its heightmap before the first layout pass. Defaults to 24.
   *
   * **Rules for accurate estimates:**
   * - Block widgets: use `padding` not `margin` for vertical spacing (CM6's
   *   `getBoundingClientRect` excludes margin → untracked height)
   * - Line decorations: never change `font-family`/`font-size` (CM6 uses
   *   default line height for off-screen line estimates)
   * - Interactive widgets with variable height: estimate conservatively
   *   (slightly too tall is OK; too short causes click-drift)
   */
  get estimatedHeight(): number {
    return 24;
  }

  // ── Editing lock management ──

  /**
   * Returns `true` when this widget holds at least one active editing lock.
   */
  protected isActive(): boolean {
    return this._activeLocks.size > 0;
  }

  /**
   * Returns the set of currently held lock reasons (for debugging).
   */
  protected get activeLocks(): ReadonlySet<WidgetLockReason> {
    return this._activeLocks;
  }

  /**
   * Acquire an editing lock for the given reason. Each call MUST be paired
   * with a {@link releaseLock} call for the same reason.
   *
   * Increments the global widget editing counter so the live-preview
   * StateField skips rebuilds.
   */
  protected acquireLock(reason: WidgetLockReason): void {
    if (this._activeLocks.has(reason)) return;
    this._activeLocks.add(reason);
    acquireWidgetEditingLock();
  }

  /**
   * Release an editing lock previously acquired with {@link acquireLock}.
   * Decrements the global counter. Safe to call even if the lock is not
   * held (noop).
   */
  protected releaseLock(reason: WidgetLockReason): void {
    if (!this._activeLocks.delete(reason)) return;
    releaseWidgetEditingLock();
  }

  /**
   * Release ALL editing locks held by this widget. Called automatically
   * in {@link destroy}. Safe to call at any time.
   */
  protected releaseAllLocks(): void {
    for (const _ of this._activeLocks) {
      releaseWidgetEditingLock();
    }
    this._activeLocks.clear();
  }

  // ── WidgetType overrides ──

  /**
   * Default `eq()`: returns `true` while locks are held (preserving DOM
   * during interactions). When no locks are held, compares by subclass
   * identity — override {@link eqKey} to customise.
   */
  eq(other: EditorWidget): boolean {
    // Always preserve DOM during active interaction
    if (this.isActive()) return true;
    // Delegate to subclass identity check
    return this.eqKey(other);
  }

  /**
   * Override to provide custom identity comparison when the widget is idle
   * (no active locks). Default: reference equality (`this === other`).
   */
  protected eqKey(_other: EditorWidget): boolean {
    return false;
  }

  /** @inheritdoc */
  ignoreEvent(): boolean {
    return true;
  }

  /**
   * CM6 calls this to create the widget's DOM. Subclasses should NOT
   * override this — override {@link buildDOM} instead.
   */
  toDOM(view: EditorView): HTMLElement {
    this.ctx = this._buildContext(view);
    this.dom = this.buildDOM();
    // Notify subclass
    this.didMount(this.ctx);
    return this.dom;
  }

  /**
   * CM6 calls this when the widget is removed from the DOM. Releases all
   * locks, calls lifecycle hooks, and cleans up references.
   */
  destroy(dom: HTMLElement): void {
    if (this.ctx) {
      this.willDestroy(this.ctx);
    }
    this.releaseAllLocks();
    this.ctx = null;
    this.dom = null;
  }

  // ── Internal helpers ──

  /**
   * Build a {@link WidgetContext} from the CM6 view. Called once in
   * {@link toDOM}. Subclasses can override to customise the context.
   */
  private _buildContext(view: EditorView): WidgetContext {
    // Derive from/to from the widget's decoration spec. Since WidgetType
    // doesn't expose this directly, we compute it from the editor state.
    // Subclasses that know their range can override _buildContext.
    return {
      view,
      from: 0, // Will be set by subclass if needed
      to: 0,
      dispatch(changes: { from: number; to: number; insert: string }) {
        view.dispatch({
          changes: { from: changes.from, to: changes.to, insert: changes.insert },
        });
      },
      isCursorInside(): boolean {
        const sel = view.state.selection.main;
        // This is a rough default; subclasses with known ranges should override
        return false;
      },
      requestMeasure<T>(req: WidgetMeasureRequest<T>) {
        view.requestMeasure(req);
      },
    };
  }
}
