import { describe, expect, it } from "vitest";
import { readAttributeConfig } from "../src/attributes";

function host(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("div");
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  return el;
}

describe("readAttributeConfig", () => {
  it("returns an empty config when no attributes are set", () => {
    expect(readAttributeConfig(host())).toEqual({});
  });

  it("treats boolean attributes as present-means-true", () => {
    const config = readAttributeConfig(
      host({ readonly: "", "indent-guides": "", "live-preview": "", "multi-cursor": "" })
    );

    expect(config.readOnly).toBe(true);
    expect(config.indentGuides).toBe(true);
    expect(config.livePreview).toBe(true);
    expect(config.multiCursor).toBe(true);
  });

  it("parses non-negative integer attributes", () => {
    const config = readAttributeConfig(
      host({ "tab-size": "2", "parse-delay-ms": "0", "slash-menu-limit": "12" })
    );

    expect(config.tabSize).toBe(2);
    expect(config.parseDelayMs).toBe(0);
    expect(config.slashMenuLimit).toBe(12);
  });

  it("drops invalid numbers instead of forwarding NaN to the editor", () => {
    const config = readAttributeConfig(
      host({ "tab-size": "abc", "parse-delay-ms": "-5", "slash-menu-limit": "1.5" })
    );

    expect(config).not.toHaveProperty("tabSize");
    expect(config).not.toHaveProperty("parseDelayMs");
    expect(config).not.toHaveProperty("slashMenuLimit");
  });

  it("accepts only ltr/rtl for direction", () => {
    expect(readAttributeConfig(host({ direction: "rtl" })).direction).toBe("rtl");
    expect(readAttributeConfig(host({ direction: "ltr" })).direction).toBe("ltr");
    expect(readAttributeConfig(host({ direction: "diagonal" }))).not.toHaveProperty("direction");
  });

  it("omits unset keys so core defaults stay in charge", () => {
    const config = readAttributeConfig(host({ readonly: "" }));

    expect(Object.keys(config)).toEqual(["readOnly"]);
  });
});
