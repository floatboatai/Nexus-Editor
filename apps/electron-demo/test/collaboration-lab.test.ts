import { describe, expect, it } from "vitest";

import { createCollaborationLab } from "../src/renderer/collaboration-lab";

describe("Electron collaboration lab", () => {
  it("shows honest experimental state, converges two Editors, and cleans up", async () => {
    const lab = await createCollaborationLab(document);
    document.body.append(lab.element);

    expect(lab.element.textContent).toContain("Experimental");
    expect(lab.element.textContent).toContain("volatile memory only");
    expect(lab.element.querySelectorAll(".cm-editor")).toHaveLength(2);
    lab.leftEditor.dispatchTransaction({
      changes: [{ from: 0, to: 0, insert: "Shared " }],
      origin: ["electron-lab-test"],
    });
    expect(lab.rightEditor.getDocument()).toBe(lab.leftEditor.getDocument());
    expect(lab.element.textContent).toContain("online/synced");

    await lab.destroy();
    expect(lab.element.isConnected).toBe(false);
    await lab.destroy();
  });
});
