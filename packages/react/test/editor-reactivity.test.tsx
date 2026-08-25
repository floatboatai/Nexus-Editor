import { darkTheme, lightTheme } from "@floatboat/nexus-core";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Editor } from "../src/index";

describe("React Editor Reactivity", () => {
  it("reactively updates readOnly when prop changes on Editor component", async () => {
    function Harness({ readOnly }: { readOnly: boolean }) {
      return <Editor initialValue="Initial content" readOnly={readOnly} />;
    }

    const { container, rerender } = render(<Harness readOnly={false} />);

    await waitFor(() => {
      const content = container.querySelector(".cm-content") as HTMLElement;
      expect(content?.getAttribute("contenteditable")).toBe("true");
    });

    // Dynamically toggle readOnly
    rerender(<Harness readOnly={true} />);

    await waitFor(() => {
      const content = container.querySelector(".cm-content") as HTMLElement;
      expect(content?.getAttribute("contenteditable")).toBe("false");
    });

    // Toggle back
    rerender(<Harness readOnly={false} />);

    await waitFor(() => {
      const content = container.querySelector(".cm-content") as HTMLElement;
      expect(content?.getAttribute("contenteditable")).toBe("true");
    });
  });

  it("reactively updates direction when prop changes", async () => {
    function Harness({ direction }: { direction: "ltr" | "rtl" }) {
      return <Editor initialValue="Direction test" direction={direction} />;
    }

    const { container, rerender } = render(<Harness direction="ltr" />);

    await waitFor(() => {
      const content = container.querySelector(".cm-content") as HTMLElement;
      expect(content?.getAttribute("dir")).toBeNull();
    });

    rerender(<Harness direction="rtl" />);

    await waitFor(() => {
      const content = container.querySelector(".cm-content") as HTMLElement;
      expect(content?.getAttribute("dir")).toBe("rtl");
    });

    rerender(<Harness direction="ltr" />);

    await waitFor(() => {
      const content = container.querySelector(".cm-content") as HTMLElement;
      expect(content?.getAttribute("dir")).toBeNull();
    });
  });

  it("reactively updates theme when prop changes", async () => {
    function Harness({ theme }: { theme: typeof lightTheme }) {
      return <Editor initialValue="Theme test" theme={theme} />;
    }

    const { container, rerender } = render(<Harness theme={lightTheme} />);

    await waitFor(() => {
      const cmEditor = container.querySelector(".cm-editor") as HTMLElement;
      expect(cmEditor).not.toBeNull();
    });

    rerender(<Harness theme={darkTheme} />);

    await waitFor(() => {
      const cmEditor = container.querySelector(".cm-editor") as HTMLElement;
      expect(cmEditor?.textContent).toContain("Theme test");
    });
  });
});
