/**
 * A minimal debounced-task scheduler with flush / cancel support.
 *
 * It is deliberately environment-agnostic: it knows nothing about
 * documents or editors. All timing policy lives here, while the
 * autosave *policy* (dirty tracking, document snapshots) stays in the
 * plugin layer. Keeping the debounce pure makes it unit-testable with
 * fake timers and no DOM — see `test/scheduler.test.ts`.
 */

export interface DebouncedTaskOptions {
  /** Quiet period in milliseconds before `run` fires. Clamped to >= 0. */
  delay: number;
  /** The work to perform once the debounce window elapses. May be async. */
  run: () => void | Promise<void>;
  /**
   * Override the timer primitives. Defaults to the global `setTimeout` /
   * `clearTimeout`. Injected so tests can supply fake timers and so
   * callers can swap in idle-time coalescing without touching the policy.
   */
  scheduleFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface DebouncedTask {
  /** (Re)start the debounce window. Calls within the window collapse to one. */
  schedule(): void;
  /**
   * Run the pending task immediately, if any. Resolves to `true` when a
   * task actually ran, `false` when nothing was pending. Awaits any async
   * work started by `run`, so callers can `await flush()` and know the
   * write finished.
   */
  flush(): Promise<boolean>;
  /** Drop a pending task without running it. */
  cancel(): void;
  /** True while a task is scheduled but has not executed yet. */
  readonly pending: boolean;
  /** True while `run` (or a `flush` awaiting it) is in flight. */
  readonly running: boolean;
  /** Clear all timers. Further calls are no-ops. */
  destroy(): void;
}

const noop = (): void => {};

export function createDebouncedTask(options: DebouncedTaskOptions): DebouncedTask {
  const delay = Math.max(0, options.delay);
  const scheduleFn = options.scheduleFn ?? setTimeout;
  const clearFn = options.clearFn ?? clearTimeout;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let running = false;

  const runNow = async (): Promise<void> => {
    if (destroyed) return;
    if (timer !== null) {
      clearFn(timer);
      timer = null;
    }
    running = true;
    try {
      await options.run();
    } finally {
      running = false;
    }
  };

  return {
    get pending(): boolean {
      return timer !== null;
    },
    get running(): boolean {
      return running;
    },
    schedule(): void {
      if (destroyed) return;
      if (timer !== null) clearFn(timer);
      timer = scheduleFn(() => {
        timer = null;
        // The timer path is fire-and-forget; swallow rejections so a
        // failing `run` never produces an unhandled rejection. `flush()`
        // surfaces errors to its caller instead.
        void runNow().catch(noop);
      }, delay);
    },
    async flush(): Promise<boolean> {
      if (destroyed || timer === null) return false;
      await runNow();
      return true;
    },
    cancel(): void {
      if (timer !== null) {
        clearFn(timer);
        timer = null;
      }
    },
    destroy(): void {
      destroyed = true;
      if (timer !== null) {
        clearFn(timer);
        timer = null;
      }
    }
  };
}
