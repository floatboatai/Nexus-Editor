type EventHandler = (...args: never[]) => void;

export class EventEmitter<EventMap extends { [K in keyof EventMap]: EventHandler }> {
  private listeners = new Map<keyof EventMap, Set<EventHandler>>();

  on<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (set?.has(handler)) return;

    const next = new Set(set);
    next.add(handler);
    this.listeners.set(event, next);
  }

  off<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set?.has(handler)) return;

    const next = new Set(set);
    next.delete(handler);
    if (next.size === 0) {
      this.listeners.delete(event);
    } else {
      this.listeners.set(event, next);
    }
  }

  emit<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): void {
    const set = this.listeners.get(event);
    if (set) {
      // on/off replace the set, so this in-flight dispatch keeps a stable snapshot.
      for (const handler of set) {
        // Handlers enter this set only through on<K>, preserving the event-key correlation.
        const eventHandler = handler as EventMap[K];
        eventHandler(...args);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
