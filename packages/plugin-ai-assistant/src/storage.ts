import type {
  AIAssistantConfig,
  AIAssistantMessage,
  AIAssistantState,
  AIAssistantStorage
} from "./types";

const DEFAULT_SESSION_KEY = "__default__";

let generatedToolCallCounter = 0;

export function createEmptyAIAssistantState(): AIAssistantState {
  return {
    messages: [],
    pendingOperations: [],
    loading: false,
    error: null
  };
}

export function normalizeSessionKey(key: string | undefined): string {
  const trimmed = key?.trim();
  return trimmed || DEFAULT_SESSION_KEY;
}

export function normalizeAIAssistantMessages(messages: AIAssistantMessage[]): AIAssistantMessage[] {
  return messages.map((message) => {
    if (!message.toolCalls || message.toolCalls.length === 0) {
      return { ...message, toolCalls: undefined };
    }

    return {
      ...message,
      toolCalls: message.toolCalls.map((toolCall) => {
        const id = toolCall.id?.trim();
        if (id) return toolCall;
        generatedToolCallCounter += 1;
        return {
          ...toolCall,
          id: `call_generated_${generatedToolCallCounter}`
        };
      })
    };
  });
}

interface PersistedAIAssistantState {
  version: 1;
  sessionKey?: string;
  sessions?: Array<[string, Partial<AIAssistantState>]>;
}

export function readPersistedState(
  storage: AIAssistantStorage,
  storageKey: string
): { sessionKey?: string; sessions: Map<string, AIAssistantState> } | null {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAIAssistantState;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return null;
    const sessions = new Map<string, AIAssistantState>();
    for (const [key, value] of parsed.sessions) {
      if (typeof key !== "string") continue;
      sessions.set(normalizeSessionKey(key), normalizePersistedSession(value));
    }
    return { sessionKey: parsed.sessionKey, sessions };
  } catch {
    return null;
  }
}

export function writePersistedState(
  storage: AIAssistantStorage,
  storageKey: string,
  sessionKey: string,
  sessions: Map<string, AIAssistantState>
): void {
  try {
    const payload: PersistedAIAssistantState = {
      version: 1,
      sessionKey,
      sessions: Array.from(sessions.entries()).map(([key, value]) => [
        key,
        {
          messages: normalizeAIAssistantMessages(value.messages),
          pendingOperations: value.pendingOperations,
          loading: false,
          error: value.error
        }
      ])
    };
    storage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    /* Ignore storage quota or unavailable storage. */
  }
}

export function readStoredConfig(
  storage: AIAssistantStorage,
  storageKey: string
): Partial<AIAssistantConfig> | null {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AIAssistantConfig>;
    return {
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : undefined,
      model: typeof parsed.model === "string" ? parsed.model : "",
      systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : undefined
    };
  } catch {
    return null;
  }
}

export function writeStoredConfig(
  storage: AIAssistantStorage,
  storageKey: string,
  config: Partial<AIAssistantConfig>
): void {
  try {
    storage.setItem(storageKey, JSON.stringify(config));
  } catch {
    /* Ignore storage quota or unavailable storage. */
  }
}

function normalizePersistedSession(value: Partial<AIAssistantState> | undefined): AIAssistantState {
  return {
    messages: Array.isArray(value?.messages) ? normalizeAIAssistantMessages(value.messages) : [],
    pendingOperations: Array.isArray(value?.pendingOperations) ? value.pendingOperations : [],
    loading: false,
    error: typeof value?.error === "string" ? value.error : null
  };
}
