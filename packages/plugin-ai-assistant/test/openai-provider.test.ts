import { describe, expect, it, vi } from "vitest";

import { createOpenAICompatibleProvider } from "../src/openai-provider";

describe("createOpenAICompatibleProvider", () => {
  it("calls an OpenAI-compatible chat completions endpoint with tools", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "readDocument",
                      arguments: "{}"
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    const provider = createOpenAICompatibleProvider(fetchMock as unknown as typeof fetch);

    const response = await provider({
      config: {
        apiKey: "sk-test",
        baseUrl: "https://example.test/v1/",
        model: "gpt-test"
      },
      messages: [{ role: "user", content: "Read this" }],
      tools: [{ type: "function", function: { name: "readDocument" } }]
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const [url, init] = calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer sk-test",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "gpt-test",
      tool_choice: "auto"
    });
    expect(response.message.toolCalls).toEqual([
      { id: "call_1", call: { tool: "readDocument" } }
    ]);
  });

  it("surfaces API errors as exceptions", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })
    );
    const provider = createOpenAICompatibleProvider(fetchMock as unknown as typeof fetch);

    await expect(
      provider({
        config: { apiKey: "bad", baseUrl: "https://example.test/v1", model: "gpt-test" },
        messages: [],
        tools: []
      })
    ).rejects.toThrow("bad key");
  });

  it("does not serialize empty tool call arrays into message history", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }]
        }),
        { status: 200 }
      )
    );
    const provider = createOpenAICompatibleProvider(fetchMock as unknown as typeof fetch);

    await provider({
      config: { apiKey: "sk-test", baseUrl: "https://example.test/v1", model: "gpt-test" },
      messages: [{ role: "assistant", content: "hello", toolCalls: [] }],
      tools: []
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0][1].body)) as { messages: Array<Record<string, unknown>> };
    expect(body.messages[0]).not.toHaveProperty("tool_calls");
  });

  it("fills missing tool call ids from compatible providers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    type: "function",
                    function: {
                      name: "readDocument",
                      arguments: "{}"
                    }
                  }
                ]
              }
            }
          ]
        }),
        { status: 200 }
      )
    );
    const provider = createOpenAICompatibleProvider(fetchMock as unknown as typeof fetch);

    const response = await provider({
      config: { apiKey: "sk-test", baseUrl: "https://example.test/v1", model: "gpt-test" },
      messages: [{ role: "user", content: "Read this" }],
      tools: [{ type: "function", function: { name: "readDocument" } }]
    });

    expect(response.message.toolCalls).toEqual([
      { id: "call_1", call: { tool: "readDocument" } }
    ]);
  });

  it("flattens tool-call history into plain context messages", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "ok" } }]
        }),
        { status: 200 }
      )
    );
    const provider = createOpenAICompatibleProvider(fetchMock as unknown as typeof fetch);

    await provider({
      config: { apiKey: "sk-test", baseUrl: "https://example.test/v1", model: "gpt-test" },
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ call: { tool: "readDocument" } }]
        } as never,
        {
          role: "tool",
          toolCallId: "call_1",
          content: JSON.stringify({ ok: true, tool: "readDocument", data: { text: "# Note" } })
        }
      ],
      tools: []
    });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const body = JSON.parse(String(calls[0][1].body)) as {
      messages: Array<{ role: string; content: string; tool_calls?: unknown; tool_call_id?: unknown }>;
    };
    expect(body.messages[0]).not.toHaveProperty("tool_calls");
    expect(body.messages[0].content).toBe("I requested editor tool calls.");
    expect(body.messages[1]).toMatchObject({
      role: "user",
      content: expect.stringContaining("Editor tool result (call_1):")
    });
    expect(body.messages[1]).not.toHaveProperty("tool_call_id");
  });
});
