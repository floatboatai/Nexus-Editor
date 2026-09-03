import { describe, expect, it, vi } from "vitest";

const rendererStartupHarness = vi.hoisted(() => ({
  renderStartupFailure: vi.fn(),
}));

vi.mock("../src/renderer/app", () => {
  throw new Error(
    "http://user:secret@localhost/private markdown must not escape module loading",
  );
});

vi.mock("../src/renderer/startup-failure", () => ({
  renderStartupFailure: rendererStartupHarness.renderStartupFailure,
}));

describe("Electron renderer entrypoint", () => {
  it("converts an application-module load failure into a bounded startup failure", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(import("../src/renderer/main")).resolves.toBeDefined();
    await vi.waitFor(() => expect(rendererStartupHarness.renderStartupFailure).toHaveBeenCalledOnce());

    expect(consoleError).toHaveBeenCalledWith(
      "Nexus renderer failed to start [renderer-startup-failed]",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("private markdown");
  });
});
