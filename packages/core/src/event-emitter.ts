export class EventEmitter<EventMap extends { [K in keyof EventMap]: (...args: any[]) => void }> {
  private listeners = new Map<keyof EventMap, Set<Function>>();

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

  /**
   * 作者：tobegold574（2026/9/17）
   * 原因：判断某事件是否至少有一个监听者，让派发方在无人监听时跳过 payload
   * 构造（省去每次更新的对象+数组分配）——轻量宿主里 selection/slash 菜单
   * 事件长期无人监听是常态。内部方法，不进公开 API。
   */
  hasListeners<K extends keyof EventMap>(event: K): boolean {
    const set = this.listeners.get(event);
    return set !== undefined && set.size > 0;
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
