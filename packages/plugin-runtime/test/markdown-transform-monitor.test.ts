import { describe, expect, it } from "vitest";

import { DiagnosticBus } from "../src/diagnostics";
import { createMarkdownTransformMonitor } from "../src/markdown-transform-monitor";

const DEFAULT_THRESHOLD_MS = 16;

describe("createMarkdownTransformMonitor", () => {
  it("emits a warning diagnostic when a contribution exceeds the threshold", () => {
    const diagnostics = new DiagnosticBus();
    const monitor = createMarkdownTransformMonitor({ diagnostics });

    monitor({
      kind: "contribution",
      registryId: "plugin.slow@1",
      version: 2,
      durationMs: DEFAULT_THRESHOLD_MS + 12.5,
    });

    expect(diagnostics.diagnostics).toHaveLength(1);
    const diagnostic = diagnostics.diagnostics[0]!;
    expect(diagnostic.severity).toBe("warning");
    expect(diagnostic.phase).toBe("runtime");
    expect(diagnostic.details).toMatchObject({
      kind: "contribution",
      registryId: "plugin.slow@1",
      version: 2,
      durationMs: DEFAULT_THRESHOLD_MS + 12.5,
      thresholdMs: DEFAULT_THRESHOLD_MS,
    });
  });

  it("emits a warning for a slow legacy pipeline sample without fake attribution", () => {
    const diagnostics = new DiagnosticBus();
    const monitor = createMarkdownTransformMonitor({ diagnostics, thresholdMs: 4 });

    monitor({
      kind: "legacy-pipeline",
      durationMs: 18.4,
    });

    expect(diagnostics.diagnostics).toHaveLength(1);
    const diagnostic = diagnostics.diagnostics[0]!;
    expect(diagnostic.details).toMatchObject({
      kind: "legacy-pipeline",
      durationMs: 18.4,
      thresholdMs: 4,
    });
    expect(diagnostic.details).not.toHaveProperty("registryId");
    expect(diagnostic.details).not.toHaveProperty("version");
  });

  it("does not emit when the transform stays under the threshold", () => {
    const diagnostics = new DiagnosticBus();
    const monitor = createMarkdownTransformMonitor({ diagnostics });

    monitor({
      kind: "contribution",
      registryId: "plugin.fast",
      version: 1,
      durationMs: 0.5,
    });

    expect(diagnostics.diagnostics).toHaveLength(0);
  });

  it("does not emit when durationMs equals the threshold exactly (strict >)", () => {
    const diagnostics = new DiagnosticBus();
    const monitor = createMarkdownTransformMonitor({ diagnostics, thresholdMs: 16 });

    monitor({
      kind: "contribution",
      registryId: "plugin.boundary",
      version: 1,
      durationMs: 16,
    });

    expect(diagnostics.diagnostics).toHaveLength(0);
  });

  it("honors a custom threshold and diagnostic code", () => {
    const diagnostics = new DiagnosticBus();
    const monitor = createMarkdownTransformMonitor({
      diagnostics,
      thresholdMs: 5,
      slowCode: "event-dispatch-budget-exceeded",
    });

    monitor({
      kind: "contribution",
      registryId: "plugin.custom",
      version: 1,
      durationMs: 6,
    });

    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]?.code).toBe("event-dispatch-budget-exceeded");
    expect(diagnostics.diagnostics[0]?.details?.thresholdMs).toBe(5);
  });

  it("keeps emitting diagnostics for repeated slow transforms (no state carried)", () => {
    const diagnostics = new DiagnosticBus();
    const monitor = createMarkdownTransformMonitor({ diagnostics, thresholdMs: 1 });

    monitor({ kind: "contribution", registryId: "a", version: 1, durationMs: 2 });
    monitor({ kind: "legacy-pipeline", durationMs: 3 });

    expect(diagnostics.diagnostics).toHaveLength(2);
  });
});
