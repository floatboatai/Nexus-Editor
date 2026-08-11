import { describe, expect, it, vi } from "vitest";
import { createFoundationModelsBridge } from "../electron/foundation-models";

describe("foundation models bridge", () => {
  it("returns unavailable instead of throwing when the native module is absent", async () => {
    const bridge = createFoundationModelsBridge({ native: null, platform: "darwin" });

    await expect(bridge.getAvailability()).resolves.toMatchObject({
      available: false,
      platform: "macos",
      minimumOS: "26.0",
      reason: "model-unavailable",
    });
    await expect(bridge.suggest("A short paragraph.")).resolves.toBeNull();
  });

  it("forwards a suggestion request to the native service", async () => {
    const native = {
      getAvailability: vi.fn().mockResolvedValue({
        available: true,
        platform: "macos" as const,
        minimumOS: "26.0" as const,
      }),
      suggest: vi.fn().mockResolvedValue("next sentence."),
      dispose: vi.fn(),
    };
    const bridge = createFoundationModelsBridge({ native, platform: "darwin" });

    await expect(bridge.suggest("paragraph")).resolves.toBe("next sentence.");
    expect(native.suggest).toHaveBeenCalledWith("paragraph");
  });

  it("disposes the native service idempotently", () => {
    const native = {
      getAvailability: vi.fn(),
      suggest: vi.fn(),
      dispose: vi.fn(),
    };
    const bridge = createFoundationModelsBridge({ native, platform: "darwin" });

    bridge.dispose();
    bridge.dispose();

    expect(native.dispose).toHaveBeenCalledTimes(1);
  });
});
