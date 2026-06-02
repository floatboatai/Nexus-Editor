/**
 * Lightweight perf instrumentation. Enabled by default — prints timings to
 * the DevTools console with the `[perf]` prefix so you can filter them.
 *
 * Toggle at runtime: set `window.NEXUS_PERF = false` to silence.
 * Long-task watchdog: any main-thread task >50ms prints a warning.
 */

type Scope = { label: string; start: number; extras?: Record<string, unknown> };

function enabled(): boolean {
  const w = globalThis as { NEXUS_PERF?: boolean };
  return w.NEXUS_PERF !== false;
}

const PREFIX = "%c[perf]";
const STYLE = "color: #0aa; font-weight: bold";

function fmt(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(2)}ms`;
}

export function perfStart(label: string, extras?: Record<string, unknown>): Scope {
  return { label, start: performance.now(), extras };
}

export function perfEnd(scope: Scope, extras?: Record<string, unknown>): number {
  const dur = performance.now() - scope.start;
  if (enabled()) {
    const merged = { ...scope.extras, ...extras };
    const hasExtras = Object.keys(merged).length > 0;
    if (hasExtras) {
      // eslint-disable-next-line no-console
      console.log(PREFIX, STYLE, scope.label, fmt(dur), merged);
    } else {
      // eslint-disable-next-line no-console
      console.log(PREFIX, STYLE, scope.label, fmt(dur));
    }
  }
  return dur;
}

export async function perfAsync<T>(
  label: string,
  fn: () => Promise<T>,
  extras?: Record<string, unknown>,
): Promise<T> {
  const s = perfStart(label, extras);
  try {
    return await fn();
  } finally {
    perfEnd(s);
  }
}

export function perfSync<T>(label: string, fn: () => T, extras?: Record<string, unknown>): T {
  const s = perfStart(label, extras);
  try {
    return fn();
  } finally {
    perfEnd(s);
  }
}

let longTaskInstalled = false;
export function installLongTaskWatch(thresholdMs = 50): void {
  if (longTaskInstalled) return;
  longTaskInstalled = true;
  const PO = (globalThis as { PerformanceObserver?: typeof PerformanceObserver })
    .PerformanceObserver;
  if (!PO) return;
  try {
    const obs = new PO((list) => {
      if (!enabled()) return;
      for (const entry of list.getEntries()) {
        if (entry.duration < thresholdMs) continue;
        // eslint-disable-next-line no-console
        console.warn(PREFIX, STYLE, `long-task ${fmt(entry.duration)}`, {
          name: entry.name,
          at: entry.startTime.toFixed(0),
        });
      }
    });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {
    // Not supported in this environment; silently skip.
  }
}
