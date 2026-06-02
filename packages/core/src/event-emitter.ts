export class EventEmitter<EventMap extends { [K in keyof EventMap]: (...args: any[]) => void }> {
  private listeners = new Map<keyof EventMap, Set<EventMap[keyof EventMap]>>();

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
        (handler as (...a: any[]) => void)(...args);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
