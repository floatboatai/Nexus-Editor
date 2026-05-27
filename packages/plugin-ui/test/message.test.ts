import { describe, expect, it } from "vitest";
import { message } from "../src/message";

describe("message", () => {
  it("exports message object with all types", () => {
    expect(message).toBeDefined();
    expect(typeof message.success).toBe("function");
    expect(typeof message.warning).toBe("function");
    expect(typeof message.error).toBe("function");
    expect(typeof message.info).toBe("function");
  });

  it("creates message element when called", () => {
    // Clear any existing messages
    const container = document.getElementById("nexus-message-container");
    if (container) container.innerHTML = "";

    message.info("test message");

    const containerAfter = document.getElementById("nexus-message-container");
    expect(containerAfter).not.toBeNull();
    expect(containerAfter?.children.length).toBeGreaterThan(0);
  });
});
