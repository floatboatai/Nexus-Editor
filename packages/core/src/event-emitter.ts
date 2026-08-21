type EventHandler = (...args: never[]) => void;

export class EventEmitter<EventMap extends { [K in keyof EventMap]: EventHandler }> {
  private listeners = new Map<keyof EventMap, Set<EventHandler>>();

  on<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
  }

  off<K extends keyof EventMap>(event: K, handler: EventMap[K]): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): void {
    const set = this.listeners.get(event);
    if (set) {
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
