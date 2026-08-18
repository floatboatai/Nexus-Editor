import type {
  MarkdownTransformObserver,
  MarkdownTransformPerformanceSample,
} from "@floatboat/nexus-core";
import type { NexusErrorCode } from "@floatboat/nexus-plugin-api";

import type { DiagnosticBus } from "./diagnostics";

/**
 * Default threshold in milliseconds above which a markdown transform is
 * reported as slow. 16ms ≈ one 60fps frame and is a practical default for
 * "slow-transform warning threshold" — it is NOT a hard performance budget:
 * a transform does not own the whole frame (input handling, transaction,
 * Lezer parse, decorations and layout share it). Hosts should tune the
 * threshold to their own latency budget.
 *
 * Kept module-internal on purpose: consumers configure the threshold with a
 * plain number, so exporting the constant would turn an implementation
 * detail into a public API contract that blocks future default tweaks.
 */
const DEFAULT_MARKDOWN_TRANSFORM_THRESHOLD_MS = 16;

export interface MarkdownTransformMonitorOptions {
  readonly diagnostics: DiagnosticBus;
  /**
   * Transforms whose duration is strictly greater than this many
   * milliseconds are reported as `warning` diagnostics — a sample exactly
   * equal to the threshold is NOT reported. Defaults to
   * {@link DEFAULT_MARKDOWN_TRANSFORM_THRESHOLD_MS}. Set to `Infinity` to
   * disable warnings while keeping samples flowing.
   */
  readonly thresholdMs?: number;
  /** Diagnostic code used for slow-transform warnings. Defaults to `"callback-failed"`. */
  readonly slowCode?: NexusErrorCode;
}

/**
 * Bridges core markdown-transform performance samples into the runtime
 * {@link DiagnosticBus}. Keeps the `core ← plugin-api ← plugin-runtime`
 * dependency direction intact: core only emits samples through the observer
 * callback; this adapter is the host-side consumer that turns them into
 * structured diagnostics.
 *
 * Native contribution snapshots are attributed individually (`registryId` +
 * `version`, discriminated by `kind: "contribution"`). The legacy unified
 * remark pipeline cannot be split, so it is reported as one whole-pipeline
 * sample (`kind: "legacy-pipeline"`) — the adapter does not pretend to know
 * which legacy plugin was slow.
 */
export function createMarkdownTransformMonitor(
  options: MarkdownTransformMonitorOptions,
): MarkdownTransformObserver {
  const thresholdMs = options.thresholdMs ?? DEFAULT_MARKDOWN_TRANSFORM_THRESHOLD_MS;
  const slowCode = options.slowCode ?? "callback-failed";
  const diagnostics = options.diagnostics;

  return (sample: MarkdownTransformPerformanceSample): void => {
    // Strictly greater: a transform exactly at the threshold is not slow.
    if (!(sample.durationMs > thresholdMs)) {
      return;
    }
    if (sample.kind === "contribution") {
      diagnostics.emit({
        code: slowCode,
        severity: "warning",
        phase: "runtime",
        message: `Slow markdown transform: ${sample.registryId}@${sample.version} took ${sample.durationMs.toFixed(2)}ms (threshold ${thresholdMs}ms)`,
        details: {
          kind: sample.kind,
          registryId: sample.registryId,
          version: sample.version,
          durationMs: sample.durationMs,
          thresholdMs,
        },
      });
      return;
    }
    diagnostics.emit({
      code: slowCode,
      severity: "warning",
      phase: "runtime",
      message: `Slow legacy remark pipeline took ${sample.durationMs.toFixed(2)}ms (threshold ${thresholdMs}ms)`,
      details: {
        kind: sample.kind,
        durationMs: sample.durationMs,
        thresholdMs,
      },
    });
  };
}
