import type { EditorAPI, NexusPlugin, TocEntry } from "@floatboat/nexus-core";

export interface AIAssistantConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt?: string;
}

export interface AIAssistantOptions {
  config?: Partial<AIAssistantConfig>;
  provider?: AIAssistantProvider;
  contextProvider?: () => string | null | undefined;
  sessionKey?: string;
  storage?: AIAssistantStorage;
  storageKey?: string;
  maxToolRounds?: number;
}

export interface AIAssistantStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type AIAssistantRole = "system" | "developer" | "user" | "assistant" | "tool";

export interface AIAssistantMessage {
  role: AIAssistantRole;
  content: string;
  toolCallId?: string;
  toolCalls?: ParsedAIToolCall[];
}

export interface AIAssistantProviderRequest {
  config: AIAssistantConfig;
  messages: AIAssistantMessage[];
  tools: readonly unknown[];
}

export interface AIAssistantProviderResponse {
  message: AIAssistantMessage;
}

export type AIAssistantProvider = (
  request: AIAssistantProviderRequest
) => Promise<AIAssistantProviderResponse>;

export type AIToolName =
  | "readDocument"
  | "readSelection"
  | "searchText"
  | "replaceRange"
  | "insertAt"
  | "replaceSelection"
  | "setSelection"
  | "getTableOfContents";

export type AIToolCall =
  | { tool: "readDocument" }
  | { tool: "readSelection" }
  | { tool: "searchText"; query: string; caseSensitive?: boolean }
  | { tool: "replaceRange"; from: number; to: number; text: string }
  | { tool: "insertAt"; pos: number; text: string }
  | { tool: "replaceSelection"; text: string }
  | { tool: "setSelection"; anchor: number; head?: number }
  | { tool: "getTableOfContents" };

export interface ParsedAIToolCall {
  id: string;
  call: AIToolCall;
}

export interface AIToolResult {
  ok: boolean;
  tool: AIToolName;
  data?: unknown;
  error?: string;
}

export interface AIToolExecution {
  result: AIToolResult;
  pendingOperation?: AIPendingOperation;
}

export interface AIPendingOperationBase {
  id: string;
  before: string;
  after: string;
}

export type AIPendingOperation =
  | (AIPendingOperationBase & {
      kind: "replaceRange";
      from: number;
      to: number;
      text: string;
    })
  | (AIPendingOperationBase & {
      kind: "insertAt";
      pos: number;
      text: string;
    })
  | (AIPendingOperationBase & {
      kind: "replaceSelection";
      text: string;
      selection: { anchor: number; head: number };
    });

export interface AIAssistantState {
  messages: AIAssistantMessage[];
  pendingOperations: AIPendingOperation[];
  loading: boolean;
  error: string | null;
}

export interface AIAssistantAPI {
  getState(): AIAssistantState;
  setConfig(config: Partial<AIAssistantConfig>): void;
  setSessionKey(key: string): void;
  clearConversation(): void;
  sendMessage(content: string): Promise<void>;
  applyOperation(id: string): boolean;
  discardOperation(id: string): boolean;
  subscribe(listener: (state: AIAssistantState) => void): () => void;
  destroy(): void;
}

export type AIAssistantPlugin = NexusPlugin &
  AIAssistantAPI & {
    attachEditor(editor: EditorAPI): void;
  };

export interface AIAssistantPanelOptions {
  container?: HTMLElement;
  classPrefix?: string;
  defaultOpen?: boolean;
  storage?: AIAssistantStorage;
  storageKey?: string;
  enabled?: boolean;
  disabledMessage?: string;
  onApplyOperation?(operationId: string): void | Promise<void>;
}

export interface AIAssistantPanel {
  element: HTMLElement;
  setOpen(open: boolean): void;
  setEnabled(enabled: boolean, message?: string): void;
  destroy(): void;
}

export type AITableOfContents = TocEntry[];
