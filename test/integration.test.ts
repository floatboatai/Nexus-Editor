import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import { createMathPlugin } from "@floatboat/nexus-plugin-math";
import { createToolbarPlugin } from "@floatboat/nexus-plugin-toolbar";
import {
  attachWordCountPlugin,
  createWordCountPlugin,
} from "@floatboat/nexus-plugin-wordcount";

/** Flush microtasks + macrotasks so CodeMirror measures / plugin
 *  microtask recomputes have a chance to run in jsdom. */
function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MATH_DOC = `$$\nx = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$`;

describe("cross-package integration: core + math + toolbar + wordcount", () => {
  let host: HTMLElement;
  let statusBarHost: HTMLElement;
  const editors: EditorAPI[] = [];

  beforeEach(() => {
    host = document.createElement("div");
    host.style.width = "800px";
    host.style.height = "600px";
    document.body.appendChild(host);

    statusBarHost = document.createElement("div");
    document.body.appendChild(statusBarHost);
  });

  afterEach(() => {
    while (editors.length) {
      const editor = editors.pop();
      try {
        editor?.destroy();
      } catch {
        /* already torn down */
      }
    }
    host.remove();
    statusBarHost.remove();
  });

  it("mounts all three plugins and exposes the document + toolbar slash commands", () => {
    const editor = createEditor({
      container: host,
      initialValue: "# Title\n\nSome **bold** text.",
      plugins: [createMathPlugin(), createToolbarPlugin(), createWordCountPlugin()],
    });
    editors.push(editor);

    // Public API contract.
    expect(editor.getDocument()).toBe("# Title\n\nSome **bold** text.");

    // Toolbar plugin's slash catalogue flowed into the editor (cross-package
    // wiring: core consumed the toolbar plugin's slashCommands).
    const slash = editor.getSlashCommands();
    expect(slash.some((cmd) => cmd.id === "bold")).toBe(true);
    expect(slash.some((cmd) => cmd.id === "code-block")).toBe(true);
  });

  it("flows the math plugin's remark plugin through the export pipeline", () => {
    const editor = createEditor({
      container: host,
      initialValue: MATH_DOC,
      plugins: [createMathPlugin()],
    });
    editors.push(editor);

    // In a headless (jsdom) environment the live-preview widget is not drawn
    // into the DOM, so instead we assert on the markdown -> HTML export,
    // which exercises core's unified pipeline WITH the math plugin's
    // remarkMath applied end-to-end (real cross-package data flow).
    //
    // remarkMath parses $$...$$ into a `math` mdast node, which remark-rehype
    // serializes as <pre><code class="language-math">…</code></pre>. The raw
    // $$ delimiters are consumed — so their absence + the language-math class
    // together prove the plugin's remarkPlugins actually flowed into core's
    // export pipeline.
    const html = editor.exportHTML();
    expect(html).not.toContain("$$");
    expect(html).toContain("language-math");
  });

  it("emits onChange on real edits but stays silent on setDocument({ silent: true })", () => {
    const onChange = vi.fn();
    const editor = createEditor({
      container: host,
      initialValue: "hello",
      onChange,
      plugins: [createMathPlugin(), createToolbarPlugin(), createWordCountPlugin()],
    });
    editors.push(editor);

    // Creation must not fire onChange.
    expect(onChange).not.toHaveBeenCalled();

    // A real (non-silent) document replacement is a user-facing change.
    onChange.mockClear();
    editor.setDocument("hello world");
    expect(onChange).toHaveBeenCalledTimes(1);

    // A silent load (e.g. opening a file from disk) must NOT emit onChange.
    onChange.mockClear();
    editor.setDocument("hello again", { silent: true });
    expect(onChange).not.toHaveBeenCalled();
    expect(editor.getDocument()).toBe("hello again");
  });

  it("updates the word-count status bar after a cross-package doc change", async () => {
    const wordcount = createWordCountPlugin({
      debounceMs: 0,
      statusBar: { container: statusBarHost },
    });
    const editor = createEditor({
      container: host,
      initialValue: "",
      plugins: [wordcount],
    });
    editors.push(editor);
    attachWordCountPlugin(wordcount, editor);

    // Initial microtask compute for an empty doc.
    await tick(0);
    const words = (): string =>
      statusBarHost.querySelector('[data-test-id="nexus-wordcount-words"]')?.textContent ?? "";
    expect(words()).toContain("0");

    // A real edit flows: core change event -> wordcount recompute -> status bar DOM.
    editor.setDocument("alpha beta gamma");
    await tick(0);
    expect(words()).toContain("3");
  });
});
