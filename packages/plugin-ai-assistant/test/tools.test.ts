import { describe, expect, it } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

import {
  executeAIToolCall,
  parseAssistantToolCalls
} from "../src/tools";

function setup(initialValue = "# Title\n\nalpha beta alpha") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const editor = createEditor({ container, initialValue });
  return {
    editor,
    container,
    destroy() {
      editor.destroy();
      container.remove();
    }
  };
}

describe("AI assistant tools", () => {
  it("reads the current document and selection", () => {
    const h = setup("alpha beta");
    h.editor.setSelection(0, 5);

    expect(executeAIToolCall(h.editor, { tool: "readDocument" }).result).toMatchObject({
      ok: true,
      tool: "readDocument",
      data: { text: "alpha beta", length: 10 }
    });
    expect(executeAIToolCall(h.editor, { tool: "readSelection" }).result).toMatchObject({
      ok: true,
      tool: "readSelection",
      data: { text: "alpha" }
    });

    h.destroy();
  });

  it("searches literal text and returns ranges", () => {
    const h = setup("Alpha beta alpha");

    const result = executeAIToolCall(h.editor, { tool: "searchText", query: "alpha" }).result;

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      matches: [
        { from: 0, to: 5 },
        { from: 11, to: 16 }
      ]
    });

    h.destroy();
  });

  it("turns write tools into pending operations without changing the document", () => {
    const h = setup("alpha beta");

    const execution = executeAIToolCall(h.editor, {
      tool: "replaceRange",
      from: 0,
      to: 5,
      text: "gamma"
    });

    expect(h.editor.getDocument()).toBe("alpha beta");
    expect(execution.result).toMatchObject({
      ok: true,
      tool: "replaceRange",
      data: { status: "pending_approval" }
    });
    expect(execution.pendingOperation).toMatchObject({
      kind: "replaceRange",
      before: "alpha",
      after: "gamma"
    });

    h.destroy();
  });

  it("rejects invalid ranges", () => {
    const h = setup("alpha");

    const result = executeAIToolCall(h.editor, {
      tool: "replaceRange",
      from: 4,
      to: 2,
      text: "x"
    }).result;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Range start");
    expect(h.editor.getDocument()).toBe("alpha");

    h.destroy();
  });

  it("parses OpenAI tool_calls from assistant messages", () => {
    const parsed = parseAssistantToolCalls({
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "searchText",
            arguments: JSON.stringify({ query: "TODO", caseSensitive: true })
          }
        }
      ]
    });

    expect(parsed).toEqual([
      {
        id: "call_1",
        call: { tool: "searchText", query: "TODO", caseSensitive: true }
      }
    ]);
  });
});
