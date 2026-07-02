import { describe, expect, it, vi } from "vitest";
import { createEditor } from "@floatboat/nexus-core";

import { createAIAssistantPanel } from "../src/panel";
import { attachAIAssistantPlugin, createAIAssistantPlugin } from "../src/plugin";
import type { AIAssistantProvider } from "../src/types";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(provider: AIAssistantProvider, initialValue = "alpha TODO beta") {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const assistant = createAIAssistantPlugin({
    provider,
    config: { apiKey: "sk-test", model: "gpt-test" }
  });
  const editor = createEditor({
    container,
    initialValue,
    plugins: [assistant]
  });
  attachAIAssistantPlugin(assistant, editor);
  return {
    editor,
    assistant,
    container,
    destroy() {
      assistant.destroy();
      editor.destroy();
      container.remove();
    }
  };
}

describe("createAIAssistantPlugin", () => {
  it("runs multiple read-tool rounds before preparing a pending edit", async () => {
    const provider = vi.fn<AIAssistantProvider>(async ({ messages }) => {
      const sawSearchResult = messages.some(
        (message) => message.role === "tool" && message.content.includes("searchText")
      );
      if (!sawSearchResult) {
        return {
          message: {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", call: { tool: "searchText", query: "TODO" } }]
          }
        };
      }
      return {
        message: {
          role: "assistant",
          content: "I prepared one replacement.",
          toolCalls: [
            {
              id: "call_2",
              call: { tool: "replaceRange", from: 6, to: 10, text: "Done" }
            }
          ]
        }
      };
    });
    const h = setup(provider);

    await h.assistant.sendMessage("Replace TODO with Done");

    expect(provider).toHaveBeenCalledTimes(2);
    expect(h.editor.getDocument()).toBe("alpha TODO beta");
    expect(h.assistant.getState().pendingOperations).toHaveLength(1);

    h.assistant.applyOperation(h.assistant.getState().pendingOperations[0].id);
    expect(h.editor.getDocument()).toBe("alpha Done beta");

    h.destroy();
  });

  it("stops with an error when provider fails", async () => {
    const h = setup(async () => {
      throw new Error("network down");
    });

    await h.assistant.sendMessage("Hello");

    expect(h.assistant.getState().error).toBe("network down");
    expect(h.assistant.getState().loading).toBe(false);

    h.destroy();
  });

  it("includes host context when provided", async () => {
    const provider = vi.fn<AIAssistantProvider>(async () => ({
      message: { role: "assistant", content: "I can see the file." }
    }));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const assistant = createAIAssistantPlugin({
      provider,
      contextProvider: () => "Current file: /tmp/note.md",
      config: { apiKey: "sk-test", model: "gpt-test" }
    });
    const editor = createEditor({
      container,
      initialValue: "# Note",
      plugins: [assistant]
    });
    attachAIAssistantPlugin(assistant, editor);

    await assistant.sendMessage("Where am I?");

    const firstCall = provider.mock.calls[0][0];
    expect(firstCall.messages[0].content).toContain("Current file: /tmp/note.md");

    assistant.destroy();
    editor.destroy();
    container.remove();
  });

  it("normalizes provider tool calls without ids before running tools", async () => {
    const provider = vi.fn<AIAssistantProvider>(async ({ messages }) => {
      const sawToolResult = messages.some(
        (message) => message.role === "tool" && message.toolCallId?.startsWith("call_generated_")
      );
      if (sawToolResult) {
        return { message: { role: "assistant", content: "Read it." } };
      }
      return {
        message: {
          role: "assistant",
          content: "",
          toolCalls: [{ call: { tool: "readDocument" } }]
        } as never
      };
    });
    const h = setup(provider, "# Title");

    await h.assistant.sendMessage("Read current document");

    expect(provider).toHaveBeenCalledTimes(2);
    expect(h.assistant.getState().error).toBeNull();

    h.destroy();
  });

  it("keeps separate conversations per session key", async () => {
    const provider = vi.fn<AIAssistantProvider>(async ({ messages }) => {
      const lastUser = [...messages].reverse().find((message) => message.role === "user");
      return { message: { role: "assistant", content: `Reply to ${lastUser?.content ?? ""}` } };
    });
    const h = setup(provider);

    h.assistant.setSessionKey("/tmp/file-a.md");
    await h.assistant.sendMessage("from file A");
    expect(h.assistant.getState().messages.map((message) => message.content)).toContain("from file A");

    h.assistant.setSessionKey("/tmp/file-b.md");
    expect(h.assistant.getState().messages).toHaveLength(0);

    await h.assistant.sendMessage("from file B");
    expect(h.assistant.getState().messages.map((message) => message.content)).toContain("from file B");
    expect(h.assistant.getState().messages.map((message) => message.content)).not.toContain("from file A");

    h.assistant.setSessionKey("/tmp/file-a.md");
    expect(h.assistant.getState().messages.map((message) => message.content)).not.toContain("from file B");

    h.destroy();
  });

  it("restores persisted conversations by storage key", async () => {
    const storageKey = "nexus-ai-test-sessions";
    localStorage.removeItem(storageKey);
    const first = setup(async () => ({
      message: { role: "assistant", content: "persisted reply" }
    }));
    first.assistant.setSessionKey("/tmp/persisted.md");
    first.assistant.setConfig({ apiKey: "sk-test", model: "gpt-test" });

    const persistedAssistant = createAIAssistantPlugin({
      provider: async () => ({ message: { role: "assistant", content: "persisted reply" } }),
      storage: localStorage,
      storageKey,
      config: { apiKey: "sk-test", model: "gpt-test" }
    });
    persistedAssistant.attachEditor(first.editor);
    persistedAssistant.setSessionKey("/tmp/persisted.md");
    await persistedAssistant.sendMessage("remember me");
    persistedAssistant.destroy();

    const restored = createAIAssistantPlugin({
      provider: async () => ({ message: { role: "assistant", content: "new reply" } }),
      storage: localStorage,
      storageKey,
      config: { apiKey: "sk-test", model: "gpt-test" }
    });
    restored.setSessionKey("/tmp/persisted.md");

    expect(restored.getState().messages.map((message) => message.content)).toContain("remember me");
    expect(restored.getState().messages.map((message) => message.content)).toContain("persisted reply");

    restored.destroy();
    first.destroy();
    localStorage.removeItem(storageKey);
  });
});

describe("createAIAssistantPanel", () => {
  it("sends user input through the assistant and renders assistant messages", async () => {
    const h = setup(async () => ({
      message: { role: "assistant", content: "Done." }
    }));
    const panel = createAIAssistantPanel(h.assistant, { container: h.container });

    const input = panel.element.querySelector<HTMLTextAreaElement>('[data-test-id="nexus-ai-input"]')!;
    const send = panel.element.querySelector<HTMLButtonElement>('[data-test-id="nexus-ai-send"]')!;
    input.value = "Hi";
    send.click();
    await flush();

    expect(panel.element.textContent).toContain("Hi");
    expect(panel.element.textContent).toContain("Done.");

    panel.destroy();
    h.destroy();
  });

  it("renders pending edits and applies them from the panel", async () => {
    const onApplyOperation = vi.fn();
    const h = setup(async () => ({
      message: {
        role: "assistant",
        content: "Review this edit.",
        toolCalls: [
          {
            id: "call_1",
            call: { tool: "replaceRange", from: 6, to: 10, text: "Done" }
          }
        ]
      }
    }));
    const panel = createAIAssistantPanel(h.assistant, { container: h.container, onApplyOperation });

    await h.assistant.sendMessage("Replace it");
    expect(panel.element.textContent).toContain("Pending changes");
    panel.element.querySelector<HTMLButtonElement>('[data-test-id="nexus-ai-apply"]')!.click();

    expect(h.editor.getDocument()).toBe("alpha Done beta");
    expect(onApplyOperation).toHaveBeenCalledTimes(1);

    panel.destroy();
    h.destroy();
  });

  it("restores stored OpenAI-compatible config", () => {
    const storageKey = "nexus-ai-test-config";
    localStorage.setItem(`${storageKey}:config`, JSON.stringify({
      apiKey: "sk-local",
      baseUrl: "https://example.test/v1",
      model: "gpt-test",
      systemPrompt: "Be concise."
    }));
    const h = setup(async () => ({
      message: { role: "assistant", content: "Done." }
    }));
    const panel = createAIAssistantPanel(h.assistant, { container: h.container, storage: localStorage, storageKey });

    expect(panel.element.querySelector<HTMLInputElement>('[data-test-id="nexus-ai-api-key"]')?.value).toBe("sk-local");
    expect(panel.element.querySelector<HTMLInputElement>('[data-test-id="nexus-ai-base-url"]')?.value).toBe("https://example.test/v1");
    expect(panel.element.querySelector<HTMLInputElement>('[data-test-id="nexus-ai-model"]')?.value).toBe("gpt-test");
    expect(panel.element.querySelector<HTMLTextAreaElement>('[data-test-id="nexus-ai-system-prompt"]')?.value).toBe("Be concise.");

    panel.destroy();
    h.destroy();
    localStorage.removeItem(`${storageKey}:config`);
  });

  it("disables chat until the host enables the panel", async () => {
    const provider = vi.fn<AIAssistantProvider>(async () => ({
      message: { role: "assistant", content: "Done." }
    }));
    const h = setup(provider);
    const panel = createAIAssistantPanel(h.assistant, {
      container: h.container,
      enabled: false,
      disabledMessage: "Open a file before using AI assistant."
    });

    const input = panel.element.querySelector<HTMLTextAreaElement>('[data-test-id="nexus-ai-input"]')!;
    const send = panel.element.querySelector<HTMLButtonElement>('[data-test-id="nexus-ai-send"]')!;
    expect(input.disabled).toBe(true);
    expect(send.disabled).toBe(true);
    expect(panel.element.textContent).toContain("Open a file before using AI assistant.");

    input.value = "Hi";
    send.click();
    await flush();
    expect(provider).not.toHaveBeenCalled();

    panel.setEnabled(true);
    expect(input.disabled).toBe(false);
    input.value = "Hi";
    send.click();
    await flush();
    expect(provider).toHaveBeenCalledTimes(1);

    panel.destroy();
    h.destroy();
  });

  it("clears the current conversation from the panel", async () => {
    const h = setup(async () => ({
      message: { role: "assistant", content: "Done." }
    }));
    const panel = createAIAssistantPanel(h.assistant, { container: h.container });

    const input = panel.element.querySelector<HTMLTextAreaElement>('[data-test-id="nexus-ai-input"]')!;
    const send = panel.element.querySelector<HTMLButtonElement>('[data-test-id="nexus-ai-send"]')!;
    input.value = "Hi";
    send.click();
    await flush();
    expect(h.assistant.getState().messages.length).toBeGreaterThan(0);

    panel.element.querySelector<HTMLButtonElement>('[data-test-id="nexus-ai-clear"]')!.click();
    expect(h.assistant.getState().messages).toHaveLength(0);
    expect(panel.element.textContent).not.toContain("Hi");

    panel.destroy();
    h.destroy();
  });
});
