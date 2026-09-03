import { beforeEach, describe, expect, it } from "vitest";

import {
  RENDERER_STARTUP_FAILURE_CODE,
  renderStartupFailure,
} from "../src/renderer/startup-failure";

describe("Electron renderer startup failure", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"><div>partial boot UI</div></div>';
  });

  it("replaces partial UI with an actionable failure surface", () => {
    renderStartupFailure();

    const failure = document.querySelector<HTMLElement>("[data-nexus-startup-failure]");
    expect(failure).not.toBeNull();
    expect(failure?.querySelector("h1")?.textContent).toBe("Nexus Editor could not start");
    expect(failure?.textContent).toContain("Close this window and restart the Electron client");
    expect(failure?.querySelector("pre")?.textContent).toBe(RENDERER_STARTUP_FAILURE_CODE);
    expect(document.querySelector("#app")?.getAttribute("data-nexus-startup-state"))
      .toBe("failed");
    expect(document.body.textContent).not.toContain("partial boot UI");
  });

  it("never renders a rejected error containing credentials or private content", () => {
    const rejectedError = new Error(
      "http://user:secret@localhost/private markdown must not be disclosed",
    );

    renderStartupFailure(rejectedError);

    expect(document.querySelector("pre")?.textContent).toBe(RENDERER_STARTUP_FAILURE_CODE);
    expect(document.body.textContent).not.toContain("secret");
    expect(document.body.textContent).not.toContain("private markdown");
  });

  it("creates a visible fallback surface when the root element is unavailable", () => {
    document.body.replaceChildren();

    expect(() => renderStartupFailure()).not.toThrow();
    expect(document.querySelector("#app")?.getAttribute("data-nexus-startup-state"))
      .toBe("failed");
    expect(document.querySelector("[data-nexus-startup-failure]")?.textContent)
      .toContain(RENDERER_STARTUP_FAILURE_CODE);
  });
});
