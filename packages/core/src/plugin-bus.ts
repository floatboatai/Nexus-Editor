/**
 * Plugin Event Bus — type-safe inter-plugin communication.
 *
 * Allows plugins to communicate without direct coupling.
 * Each plugin can emit events on named channels and subscribe
 * to events from other plugins.
 *
 * @example
 * ```ts
 * // Plugin A emits
 * bus.emit("wordcount:update", { words: 42 });
 *
 * // Plugin B subscribes
 * bus.on("wordcount:update", (data) => console.log(data.words));
 * ```
 */

export interface PluginBusSubscription {
  /** Unsubscribe this handler. */
  unsubscribe(): void;
}

export interface PluginBus {
  /**
   * Emit an event on the given channel with the provided payload.
   * All registered handlers for this channel will be invoked synchronously.
   */
  emit<T = unknown>(channel: string, payload: T): void;

  /**
   * Subscribe to events on the given channel.
   * Returns a subscription object with an `unsubscribe` method.
   */
  on<T = unknown>(channel: string, handler: (payload: T) => void): PluginBusSubscription;

  /**
   * Remove a specific handler from the given channel.
   */
  off<T = unknown>(channel: string, handler: (payload: T) => void): void;

  /**
   * Subscribe to events on the given channel, auto-removing after the first call.
   */
  once<T = unknown>(channel: string, handler: (payload: T) => void): PluginBusSubscription;

  /**
   * Remove all handlers for a given channel, or all handlers if no channel specified.
   */
  clear(channel?: string): void;
}

/**
 * Create a new PluginBus instance.
 */
export function createPluginBus(): PluginBus {
  const listeners = new Map<string, Set<(payload: any) => void>>();

  function getChannel(channel: string): Set<(payload: any) => void> {
    let set = listeners.get(channel);
    if (!set) {
      set = new Set();
      listeners.set(channel, set);
    }
    return set;
  }

  return {
    emit<T>(channel: string, payload: T): void {
      const set = listeners.get(channel);
      if (!set) return;
      for (const handler of set) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[PluginBus] Error in handler for "${channel}":`, err);
        }
      }
    },

    on<T>(channel: string, handler: (payload: T) => void): PluginBusSubscription {
      const set = getChannel(channel);
      set.add(handler as any);
      return {
        unsubscribe() {
          set.delete(handler as any);
          if (set.size === 0) listeners.delete(channel);
        },
      };
    },

    off<T>(channel: string, handler: (payload: T) => void): void {
      const set = listeners.get(channel);
      if (!set) return;
      set.delete(handler as any);
      if (set.size === 0) listeners.delete(channel);
    },

    once<T>(channel: string, handler: (payload: T) => void): PluginBusSubscription {
      const wrapper = (payload: T) => {
        sub.unsubscribe();
        handler(payload);
      };
      const sub = this.on(channel, wrapper);
      return sub;
    },

    clear(channel?: string): void {
      if (channel) {
        listeners.delete(channel);
      } else {
        listeners.clear();
      }
    },
  };
}
