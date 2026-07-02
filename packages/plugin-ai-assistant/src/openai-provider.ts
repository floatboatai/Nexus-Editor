import type {
  AIAssistantConfig,
  AIAssistantMessage,
  AIAssistantProvider,
  AIAssistantProviderRequest
} from "./types";
import { parseAssistantToolCalls } from "./tools";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAIChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: unknown[];
}

export function normalizeAIAssistantConfig(config: Partial<AIAssistantConfig>): AIAssistantConfig {
  return {
    apiKey: config.apiKey?.trim() ?? "",
    baseUrl: config.baseUrl?.trim() || DEFAULT_BASE_URL,
    model: config.model?.trim() ?? "",
    systemPrompt: config.systemPrompt
  };
}

export function createOpenAICompatibleProvider(
  fetchImpl: typeof fetch = fetch
): AIAssistantProvider {
  return async (request: AIAssistantProviderRequest) => {
    const config = normalizeAIAssistantConfig(request.config);
    if (!config.apiKey) throw new Error("OpenAI API key is required.");
    if (!config.model) throw new Error("OpenAI model is required.");

    const response = await fetchImpl(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: toOpenAIMessages(request.messages, config),
        tools: request.tools,
        tool_choice: "auto"
      })
    });

    if (!response.ok) {
      const detail = await readResponseText(response);
      throw new Error(detail || `OpenAI-compatible API request failed with HTTP ${response.status}.`);
    }

    const json = await response.json() as {
      choices?: Array<{ message?: OpenAIChatMessage }>;
    };
    const rawMessage = json.choices?.[0]?.message;
    if (!rawMessage) throw new Error("OpenAI-compatible API returned no assistant message.");

    return {
      message: fromOpenAIMessage(rawMessage)
    };
  };
}

function toOpenAIMessages(
  messages: AIAssistantMessage[],
  config: AIAssistantConfig
): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  if (config.systemPrompt?.trim()) {
    out.push({ role: "system", content: config.systemPrompt.trim() });
  }
  messages.forEach((message) => {
    if (message.role === "tool") {
      out.push({
        role: "user",
        content: `Editor tool result${message.toolCallId ? ` (${message.toolCallId})` : ""}:\n${message.content}`
      });
      return;
    }

    const item: OpenAIChatMessage = {
      role: message.role === "developer" ? "system" : message.role,
      content: message.content
    };
    if (message.toolCalls && message.toolCalls.length > 0 && !item.content) {
      item.content = "I requested editor tool calls.";
    }
    out.push(item);
  });
  return out;
}

function fromOpenAIMessage(message: OpenAIChatMessage): AIAssistantMessage {
  return {
    role: "assistant",
    content: message.content ?? "",
    toolCalls: parseAssistantToolCalls(message)
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function readResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return "";
    try {
      const json = JSON.parse(text) as { error?: { message?: string }; message?: string };
      return json.error?.message ?? json.message ?? text;
    } catch {
      return text;
    }
  } catch {
    return "";
  }
}
