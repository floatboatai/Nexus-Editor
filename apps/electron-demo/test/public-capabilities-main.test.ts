import { afterEach, describe, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => vi.fn(async () => undefined));
const publicBoot = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("../src/renderer/app", () => ({ boot }));
vi.mock("../src/renderer/public-capabilities-demo", () => ({ bootPublicCapabilitiesDemo: publicBoot }));

afterEach(() => {
  Reflect.deleteProperty(window, "nexusPublicCapabilities");
  Reflect.deleteProperty(window, "nexusPlugins");
  Reflect.deleteProperty(window, "nexusHost");
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("public capability demo entry", () => {
  it("keeps the existing boot path when the explicit bridge is absent", async () => {
    await import("../src/renderer/main");
    expect(boot).toHaveBeenCalledTimes(1);
    expect(publicBoot).not.toHaveBeenCalled();
  });

  it("mounts public capabilities after the existing app boots", async () => {
    Object.defineProperty(window, "nexusPublicCapabilities", { configurable: true, value: {} });
    Object.defineProperty(window, "nexusPlugins", { configurable: true, value: { vault: {} } });
    Object.defineProperty(window, "nexusHost", {
      configurable: true,
      value: { mode: "runtime", onShutdown: vi.fn(), shutdownComplete: vi.fn() },
    });
    publicBoot.mockResolvedValue({ requestShutdown: vi.fn(), destroy: vi.fn(async () => undefined) } as never);
    await import("../src/renderer/main");
    await vi.waitFor(() => expect(publicBoot).toHaveBeenCalledTimes(1));
    expect(boot).toHaveBeenCalledWith({ publicCapabilitiesManaged: true });
    const panel = document.querySelector<HTMLElement>(".public-capabilities-launcher");
    const close = document.querySelector<HTMLButtonElement>("[aria-label='收起公共能力']");
    expect(panel).not.toBeNull();
    close?.click();
    expect(panel?.style.display).toBe("none");
    expect(document.querySelector('[aria-label="展开公共能力"]')).toBeNull();
    window.dispatchEvent(new Event("nexus:toggle-public-capabilities"));
    expect(panel?.style.display).toBe("flex");
  });

  it("does not discard dirty content from the original editor on shutdown", async () => {
    const shutdown = vi.fn(async () => undefined);
    const cancelShutdown = vi.fn(async () => undefined);
    const requestShutdown = vi.fn(async () => true);
    let onShutdown: (() => void) | undefined;
    boot.mockResolvedValue({ state: { dirty: true }, shutdown } as never);
    publicBoot.mockResolvedValue({ requestShutdown, destroy: vi.fn(async () => undefined) } as never);
    Object.defineProperty(window, "nexusPublicCapabilities", { configurable: true, value: { cancelShutdown } });
    Object.defineProperty(window, "nexusPlugins", { configurable: true, value: { vault: {} } });
    Object.defineProperty(window, "nexusHost", {
      configurable: true,
      value: { mode: "runtime", onShutdown: (callback: () => void) => { onShutdown = callback; return () => undefined; } },
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await import("../src/renderer/main");
    await vi.waitFor(() => expect(publicBoot).toHaveBeenCalledTimes(1));
    await onShutdown?.();
    expect(cancelShutdown).toHaveBeenCalledOnce();
    expect(requestShutdown).not.toHaveBeenCalled();
    expect(shutdown).not.toHaveBeenCalled();
  });
});
