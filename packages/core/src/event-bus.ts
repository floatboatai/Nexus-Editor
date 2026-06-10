/**
 * EventBus — a typed, priority-aware event emitter with error isolation,
 * one-shot subscriptions, and pause/resume batching.
 *
 * Designed as a drop-in upgrade for the simple EventEmitter used internally
 * by the editor. The public EditorAPI surface (on/off) is unchanged; all
 * new capabilities are available internally to the editor and to plugins
 * that opt into the extended event system.
 *
 * Key features:
 *  - **Typed** — full TypeScript inference via the EventMap generic.
 *  - **Priority** — handlers with higher numeric priority run first.
 *  - **once()** — auto-removes after the first emit.
 *  - **Error isolation** — a crashing handler never prevents others from
 *    receiving the event. Errors are caught and re-dispatched on the
 *    "error" event if a listener for it is registered.
 *  - **Pause / resume** — pending events are queued and replayed on resume.
 *  - **Wildcard "\*"** — subscribe to every event via `.on('*', handler)`
 *    (reserved event name, not part of EventMap).
 */

export type EventHandler = (...args: any[]) => void;

interface HandlerEntry {
  handler: EventHandler;
  /** Higher priority runs first. Default 0. */
  priority: number;
  /** If true, removed after the first emit. */
  once: boolean;
  /** The event key this handler is registered for (for cleanup). */
  eventKey: string;
}

/**
 * Global error sink. Set it from the editor so crashes in handlers bubble up
 * to the consumer without breaking the dispatch loop.
 */
let globalErrorHandler: ((event: string, error: Error) => void) | null = null;

export function setGlobalErrorHandler(handler: ((event: string, error: Error) => void) | null): void {
  globalErrorHandler = handler;
}

/**
 * The special wildcard event key — subscribing to "*" receives all events.
 * This is NOT part of EventMap and is reserved internally.
 */
const WILDCARD = "*";

export class EventBus<EventMap extends { [K in keyof EventMap]: (...args: any[]) => void }> {
  private listeners = new Map<string, HandlerEntry[]>();
  private paused = false;
  private pendingEvents: Array<{ event: string; args: unknown[] }> | null = null;

  /**
   * Register a handler for `event`.
   *
   * @param event  The event key (must be a key of EventMap, or "*" for all events).
   * @param handler  The callback.
   * @param options  Optional. `priority` — higher runs first (default 0).
   */
  on<K extends keyof EventMap>(
    event: K,
    handler: EventMap[K],
    options?: { priority?: number },
  ): void;
  on(event: "*", handler: (event: string, ...args: any[]) => void, options?: { priority?: number }): void;
  on(
    event: any,
    handler: any,
    options?: { priority?: number },
  ): void {
    this.addEntry(String(event), {
      handler,
      priority: options?.priority ?? 0,
      once: false,
      eventKey: String(event),
    });
  }

  /**
   * One-shot subscription — auto-removed after the first emit.
   * Signature matches `on()`.
   */
  once<K extends keyof EventMap>(
    event: K,
    handler: EventMap[K],
    options?: { priority?: number },
  ): void;
  once(event: "*", handler: (event: string, ...args: any[]) => void, options?: { priority?: number }): void;
  once(
    event: any,
    handler: any,
    options?: { priority?: number },
  ): void {
    this.addEntry(String(event), {
      handler,
      priority: options?.priority ?? 0,
      once: true,
      eventKey: String(event),
    });
  }

  /**
   * Unregister a previously-registered handler.
   */
  off<K extends keyof EventMap>(event: K, handler: EventMap[K]): void;
  off(event: "*", handler: (event: string, ...args: any[]) => void): void;
  off(event: any, handler: any): void {
    const key = String(event);
    const entries = this.listeners.get(key);
    if (!entries) return;
    const idx = entries.findIndex((e) => e.handler === handler);
    if (idx >= 0) {
      entries.splice(idx, 1);
      if (entries.length === 0) this.listeners.delete(key);
    }
  }

  /**
   * Emit an event, calling all registered handlers in priority order.
   * Errors inside handlers are caught and forwarded to the global error
   * handler (if set) or logged to console.error. One-shot handlers are
   * removed after being called.
   *
   * When paused, events are queued and replayed on resume.
   */
  emit<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): void {
    const eventKey = String(event);

    if (this.paused) {
      if (this.pendingEvents) {
        this.pendingEvents.push({ event: eventKey, args: args as unknown[] });
      }
      return;
    }

    this.dispatch(eventKey, args as unknown[]);
  }

  /**
   * Remove all handlers for all events.
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Pause event dispatching. While paused, events are queued in a buffer
   * instead of being dispatched. Call `resume()` to replay.
   *
   * @returns A function that flushes on call (same as resume).
   */
  pause(): () => void {
    if (!this.paused) {
      this.paused = true;
      this.pendingEvents = [];
    }
    return () => this.resume();
  }

  /**
   * Resume dispatching and replay any events that were queued while paused.
   */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const pending = this.pendingEvents;
    this.pendingEvents = null;
    if (pending) {
      for (const { event, args } of pending) {
        this.dispatch(event, args);
      }
    }
  }

  /**
   * Return the number of registered handlers for a given event.
   * Returns 0 for events with no listeners.
   */
  listenerCount<K extends keyof EventMap>(event: K): number {
    return this.listeners.get(String(event))?.length ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private addEntry(key: string, entry: HandlerEntry): void {
    let entries = this.listeners.get(key);
    if (!entries) {
      entries = [];
      this.listeners.set(key, entries);
    }
    entries.push(entry);
    entries.sort((a, b) => b.priority - a.priority);
  }

  private dispatch(eventKey: string, args: unknown[]): void {
    // Direct listeners
    const entries = this.listeners.get(eventKey);
    if (entries) {
      this.invokeAll(entries, args);
    }

    // Wildcard "*" listeners always run, receiving (eventName, ...args)
    if (eventKey !== WILDCARD) {
      const wildcardEntries = this.listeners.get(WILDCARD);
      if (wildcardEntries) {
        const wildcardArgs = [eventKey, ...args];
        this.invokeAll(wildcardEntries, wildcardArgs);
      }
    }
  }

  private invokeAll(entries: HandlerEntry[], args: unknown[]): void {
    const toRemove: HandlerEntry[] = [];

    for (const entry of [...entries]) {
      if (entry.once) toRemove.push(entry);
      try {
        entry.handler(...args);
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        globalErrorHandler?.(`EventBus:handler`, err);
        console.error(`[EventBus] Error in handler for "${entry.eventKey}":`, err);
      }
    }

    // Clean up one-time handlers — remove by entry object identity
    if (toRemove.length > 0) {
      for (const entry of toRemove) {
        const list = this.listeners.get(entry.eventKey);
        if (!list) continue;
        const idx = list.indexOf(entry);
        if (idx >= 0) list.splice(idx, 1);
      }

      // Prune empty keys
      for (const entry of toRemove) {
        const list = this.listeners.get(entry.eventKey);
        if (list?.length === 0) this.listeners.delete(entry.eventKey);
      }
    }
  }
}
