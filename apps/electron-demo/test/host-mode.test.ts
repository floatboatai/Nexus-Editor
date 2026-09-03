import { describe, expect, it } from "vitest";

import {
  hostModeArgument,
  parseHostModeArgument,
  resolveMainHostMode,
} from "../src/shared/host-mode";

describe("Electron Host mode", () => {
  it("uses runtime as the primary product mode and keeps an explicit legacy fallback", () => {
    expect(resolveMainHostMode({})).toBe("runtime");
    expect(resolveMainHostMode({ NEXUS_PLUGIN_PLATFORM: "1" })).toBe("runtime");
    expect(resolveMainHostMode({ VITE_NEXUS_PLUGIN_PLATFORM: "1" })).toBe("runtime");
    expect(resolveMainHostMode({ NEXUS_PLUGIN_PLATFORM: "0" })).toBe("legacy");
    expect(resolveMainHostMode({ VITE_NEXUS_PLUGIN_PLATFORM: "0" })).toBe("legacy");
  });

  it("rejects an invalid explicit Host mode instead of silently changing products", () => {
    expect(() => resolveMainHostMode({ NEXUS_PLUGIN_PLATFORM: "yes" })).toThrow(
      "NEXUS_PLUGIN_PLATFORM must be either '1' (runtime) or '0' (legacy)",
    );
  });

  it("keeps the main-to-preload argument fail-closed", () => {
    expect(hostModeArgument("runtime")).toBe("--nexus-host-mode=runtime");
    expect(parseHostModeArgument(["electron", "--nexus-host-mode=runtime"]))
      .toBe("runtime");
    expect(parseHostModeArgument(["electron", "--nexus-host-mode=unexpected"]))
      .toBe("legacy");
    expect(parseHostModeArgument(["electron"])).toBe("legacy");
  });
});
