/**
 * Main-process counterpart of the renderer `perf.ts` instrumentation.
 * Enabled by default; prints `[perf]` lines to stdout so a packaged app
 * launched from a terminal (or a harness spawning the binary) can read
 * launch timings. Silence with NEXUS_PERF=0.
 */

const t0 = Date.now();

const silenced = process.env.NEXUS_PERF === "0";

function fmt(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms >= 10) return `${ms.toFixed(1)}ms`;
  return `${ms.toFixed(2)}ms`;
}

export interface MainPerfMark {
  readonly at: number;
  readonly label: string;
}

export function perfMark(label: string): MainPerfMark {
  return { at: Date.now() - t0, label };
}

export function perfLog(mark: MainPerfMark, label?: string, extras?: Record<string, unknown>): void {
  if (silenced) return;
  const line = [`[perf] ${label ?? mark.label}`, fmt(mark.at), extras].filter(Boolean);
  // eslint-disable-next-line no-console
  console.log(...line);
}
