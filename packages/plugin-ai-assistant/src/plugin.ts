import type { EditorAPI } from "@floatboat/nexus-core";

import { createOpenAICompatibleProvider, normalizeAIAssistantConfig } from "./openai-provider";
import {
  AI_TOOL_DEFINITIONS,
  executeAIToolCall
} from "./tools";
import {
  createEmptyAIAssistantState,
  normalizeAIAssistantMessages,
  normalizeSessionKey,
  readPersistedState,
  writePersistedState
} from "./storage";
import type {
  AIAssistantConfig,
  AIAssistantMessage,
  AIAssistantOptions,
  AIAssistantPlugin,
  AIAssistantProvider,
  AIAssistantState,
  AIPendingOperation
} from "./types";

const DEFAULT_MAX_TOOL_ROUNDS = 6;

const DEFAULT_SYSTEM_PROMPT = [
  "You are Nexus AI Assistant, an editing agent embedded in a Markdown editor.",
  "Use editor tools when a request depends on the current document.",
  "Never invent character offsets. Use readDocument, readSelection, or searchText first.",
  "Keep edits minimal and targeted.",
  "Write tools only prepare pending edits. Tell the user to review and apply them.",
  "Do not request or reveal API keys."
].join("\n");

export function createAIAssistantPlugin(options: AIAssistantOptions = {}): AIAssistantPlugin {
  let editor: EditorAPI | null = null;
  let destroyed = false;
  let config: AIAssistantConfig = normalizeAIAssistantConfig({
    baseUrl: "https://api.openai.com/v1",
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    ...options.config
  });
  const provider: AIAssistantProvider = options.provider ?? createOpenAICompatibleProvider();
  const contextProvider = options.contextProvider;
  const storageKey = options.storageKey?.trim();
  const storage = options.storage;
  const stored = storage && storageKey ? readPersistedState(storage, storageKey) : null;
  const maxToolRounds = Math.max(1, Math.floor(options.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS));
  let sessionKey = normalizeSessionKey(options.sessionKey ?? stored?.sessionKey);
  const sessions = stored?.sessions ?? new Map<string, AIAssistantState>();
  if (!sessions.has(sessionKey)) sessions.set(sessionKey, createEmptyAIAssistantState());
  let state = sessions.get(sessionKey)!;
  const listeners = new Set<(state: AIAssistantState) => void>();

  const emit = (): void => {
    if (destroyed) return;
    const snapshot = getStateSnapshot();
    for (const listener of listeners) listener(snapshot);
  };

  const setState = (next: Partial<AIAssistantState>): void => {
    setSessionState(sessionKey, next);
    emit();
  };

  const appendMessages = (messages: AIAssistantMessage[]): void => {
    setSessionState(sessionKey, { messages: state.messages.concat(messages) });
    emit();
  };

  const setSessionState = (key: string, next: Partial<AIAssistantState>): AIAssistantState => {
    const current = sessions.get(key) ?? createEmptyAIAssistantState();
    const updated = {
      ...current,
      ...next,
      messages: next.messages ? normalizeAIAssistantMessages(next.messages) : current.messages
    };
    sessions.set(key, updated);
    if (key === sessionKey) state = updated;
    persist();
    return updated;
  };

  const persist = (): void => {
    if (!storage || !storageKey || destroyed) return;
    writePersistedState(storage, storageKey, sessionKey, sessions);
  };

  const getStateSnapshot = (): AIAssistantState => ({
    messages: state.messages.slice(),
    pendingOperations: state.pendingOperations.slice(),
    loading: state.loading,
    error: state.error
  });

  const createContextMessage = (): AIAssistantMessage | null => {
    if (!editor) return null;
    const doc = editor.getDocument();
    const selection = editor.getSelection();
    const selectionLength = Math.abs(selection.head - selection.anchor);
    const headings = editor.getTableOfContents().slice(0, 12).map((entry) => `${"#".repeat(entry.level)} ${entry.text}`);
    const hostContext = contextProvider?.()?.trim();
    return {
      role: "user",
      content: [
        "Editor context:",
        hostContext ? `- Host context:\n${hostContext}` : null,
        `- Document length: ${doc.length} characters`,
        `- Selection length: ${selectionLength} characters`,
        headings.length > 0 ? `- Headings:\n${headings.join("\n")}` : "- Headings: none",
        "",
        "If exact content is needed, call readDocument or readSelection."
      ].filter(Boolean).join("\n")
    };
  };

  const runToolCalls = (assistantMessage: AIAssistantMessage): boolean => {
    if (!editor || !assistantMessage.toolCalls || assistantMessage.toolCalls.length === 0) {
      return false;
    }

    const toolMessages: AIAssistantMessage[] = [];
    const pending: AIPendingOperation[] = [];
    for (const parsed of assistantMessage.toolCalls) {
      const execution = executeAIToolCall(editor, parsed.call);
      if (execution.pendingOperation) pending.push(execution.pendingOperation);
      toolMessages.push({
        role: "tool",
        toolCallId: parsed.id,
        content: JSON.stringify(execution.result)
      });
    }

    setSessionState(sessionKey, {
      messages: state.messages.concat(toolMessages),
      pendingOperations: state.pendingOperations.concat(pending)
    });
    emit();
    return pending.length > 0;
  };

  async function sendMessage(content: string): Promise<void> {
    if (destroyed) return;
    if (!editor) {
      setState({ error: "AI assistant is not attached to an editor." });
      return;
    }

    const trimmed = content.trim();
    if (!trimmed) return;

    const userMessage: AIAssistantMessage = { role: "user", content: trimmed };
    setSessionState(sessionKey, {
      messages: state.messages.concat(userMessage),
      loading: true,
      error: null
    });
    emit();

    try {
      for (let round = 0; round < maxToolRounds; round++) {
        const context = createContextMessage();
        const requestMessages = normalizeAIAssistantMessages(context ? [context, ...state.messages] : state.messages);
        const response = await provider({
          config,
          messages: requestMessages,
          tools: AI_TOOL_DEFINITIONS
        });

        const assistantMessage = normalizeAIAssistantMessages([response.message])[0];
        appendMessages([assistantMessage]);
        const hasPendingWrites = runToolCalls(assistantMessage);
        if (!assistantMessage.toolCalls || assistantMessage.toolCalls.length === 0 || hasPendingWrites) {
          setState({ loading: false });
          return;
        }
      }

      setState({
        loading: false,
        error: "The assistant reached the tool-call limit. Try a narrower request."
      });
    } catch (err) {
      setState({
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  function applyOperation(id: string): boolean {
    if (!editor || destroyed) return false;
    const operation = state.pendingOperations.find((item) => item.id === id);
    if (!operation) return false;

    const doc = editor.getDocument();
    try {
      switch (operation.kind) {
        case "replaceRange":
          if (doc.slice(operation.from, operation.to) !== operation.before) {
            setState({ error: "Document changed since this edit was proposed. Discard it and ask again." });
            return false;
          }
          editor.replaceRange(operation.from, operation.to, operation.text);
          break;
        case "insertAt":
          if (operation.pos > doc.length) {
            setState({ error: "Insert position is outside the current document." });
            return false;
          }
          editor.replaceRange(operation.pos, operation.pos, operation.text);
          break;
        case "replaceSelection": {
          const from = Math.min(operation.selection.anchor, operation.selection.head);
          const to = Math.max(operation.selection.anchor, operation.selection.head);
          if (doc.slice(from, to) !== operation.before) {
            setState({ error: "Selection text changed since this edit was proposed. Discard it and ask again." });
            return false;
          }
          editor.replaceRange(from, to, operation.text);
          break;
        }
      }
    } catch (err) {
      setState({ error: err instanceof Error ? err.message : String(err) });
      return false;
    }

    setSessionState(sessionKey, {
      pendingOperations: state.pendingOperations.filter((item) => item.id !== id),
      error: null
    });
    emit();
    return true;
  }

  function discardOperation(id: string): boolean {
    const before = state.pendingOperations.length;
    const nextPending = state.pendingOperations.filter((item) => item.id !== id);
    const changed = nextPending.length !== before;
    setSessionState(sessionKey, {
      pendingOperations: nextPending
    });
    if (changed) emit();
    return changed;
  }

  const plugin: AIAssistantPlugin = {
    name: "plugin-ai-assistant",
    cmExtensions: [],
    getState: getStateSnapshot,
    setConfig(next) {
      config = normalizeAIAssistantConfig({ ...config, ...next });
      emit();
    },
    setSessionKey(nextKey) {
      const normalized = normalizeSessionKey(nextKey);
      if (normalized === sessionKey) return;
      sessions.set(sessionKey, state);
      sessionKey = normalized;
      state = sessions.get(sessionKey) ?? createEmptyAIAssistantState();
      sessions.set(sessionKey, state);
      persist();
      emit();
    },
    clearConversation() {
      setSessionState(sessionKey, createEmptyAIAssistantState());
      emit();
    },
    sendMessage,
    applyOperation,
    discardOperation,
    subscribe(listener) {
      listeners.add(listener);
      listener(getStateSnapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor = null;
      listeners.clear();
      sessions.clear();
      state = createEmptyAIAssistantState();
    },
    attachEditor(target) {
      if (destroyed || editor) return;
      editor = target;
    }
  };

  return plugin;
}

export function attachAIAssistantPlugin(plugin: AIAssistantPlugin, editor: EditorAPI): void {
  plugin.attachEditor(editor);
}
