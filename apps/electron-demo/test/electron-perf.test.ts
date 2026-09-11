import { afterEach, describe, expect, it, vi } from "vitest";

const PERF_ENV = "NEXUS_PERF";

async function importPerf() {
  vi.resetModules();
  return import("../electron/perf");
}

describe("main-process perf instrumentation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports elapsed time since module load", async () => {
    const { perfMark } = await importPerf();
    const before = Date.now();
    const mark = perfMark("sample");
    expect(mark.label).toBe("sample");
    expect(mark.at).toBeGreaterThanOrEqual(0);
    expect(mark.at).toBeLessThanOrEqual(Date.now() - before + 100);
  });

  it("writes a parseable [perf] line to stdout when enabled", async () => {
    vi.stubEnv(PERF_ENV, "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { perfLog, perfMark } = await importPerf();
    perfLog(perfMark("app-ready"), "app-ready");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [headline, time] = logSpy.mock.calls[0] as unknown as [string, string];
    expect(headline).toBe("[perf] app-ready");
    expect(time).toMatch(/^([0-9.]+)(ms|s)$/u);
  });

  it("stays silent when NEXUS_PERF=0", async () => {
    vi.stubEnv(PERF_ENV, "0");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { perfLog, perfMark } = await importPerf();
    perfLog(perfMark("app-ready"), "app-ready");
    expect(logSpy).not.toHaveBeenCalled();
  });
});
