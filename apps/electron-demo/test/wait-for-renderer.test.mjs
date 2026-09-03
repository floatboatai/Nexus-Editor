import { describe, expect, it, vi } from "vitest";

import { waitForRendererDevServer } from "../scripts/wait-for-renderer.mjs";

describe("Electron renderer development readiness", () => {
  it("retries until the renderer server is reachable", async () => {
    const probe = vi.fn()
      .mockRejectedValueOnce(new Error("not ready"))
      .mockRejectedValueOnce(new Error("not ready"))
      .mockResolvedValue(undefined);

    await waitForRendererDevServer("http://localhost:5173", {
      intervalMs: 1,
      timeoutMs: 100,
      probe,
    });

    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("fails with a bounded diagnostic instead of launching a blank window", async () => {
    const probe = vi.fn().mockRejectedValue(
      new Error("http://user:secret@localhost/private markdown"),
    );

    let failure;
    try {
      await waitForRendererDevServer("http://localhost:5173", {
        intervalMs: 1,
        timeoutMs: 5,
        probe,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe(
      "Renderer development server did not become ready within 5 ms",
    );
    expect(failure.message).not.toContain("secret");
    expect(failure.message).not.toContain("private markdown");
    expect(failure.message).not.toContain("http://");
  });

  it("rejects non-loopback renderer URLs", async () => {
    await expect(waitForRendererDevServer("https://example.com", {
      probe: vi.fn(),
    })).rejects.toThrow("Renderer development server must use loopback HTTP");
  });
});
