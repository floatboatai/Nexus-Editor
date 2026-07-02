import type {
  AIAssistantPanel,
  AIAssistantPanelOptions,
  AIAssistantPlugin,
  AIPendingOperation
} from "./types";
import { readStoredConfig, writeStoredConfig } from "./storage";

export function createAIAssistantPanel(
  assistant: AIAssistantPlugin,
  options: AIAssistantPanelOptions = {}
): AIAssistantPanel {
  const prefix = options.classPrefix ?? "nexus-ai";
  const storage = options.storage;
  const configStorageKey = storage && options.storageKey ? `${options.storageKey}:config` : null;
  const storedConfig = storage && configStorageKey ? readStoredConfig(storage, configStorageKey) : null;
  const root = document.createElement("aside");
  root.className = `${prefix}__panel`;
  root.dataset.testId = "nexus-ai-panel";
  root.setAttribute("aria-label", "AI assistant");
  root.style.display = options.defaultOpen === false ? "none" : "";

  const configForm = document.createElement("form");
  configForm.className = `${prefix}__config`;

  const apiKeyInput = createInput("password", "API key", "nexus-ai-api-key");
  apiKeyInput.value = storedConfig?.apiKey ?? "";
  const baseUrlInput = createInput("url", "Base URL", "nexus-ai-base-url");
  baseUrlInput.value = storedConfig?.baseUrl ?? "https://api.openai.com/v1";
  const modelInput = createInput("text", "Model", "nexus-ai-model");
  modelInput.value = storedConfig?.model ?? "";
  modelInput.placeholder = "gpt-4.1";
  const systemPromptInput = document.createElement("textarea");
  systemPromptInput.className = `${prefix}__system`;
  systemPromptInput.dataset.testId = "nexus-ai-system-prompt";
  systemPromptInput.placeholder = "Optional system prompt";
  systemPromptInput.rows = 3;
  systemPromptInput.value = storedConfig?.systemPrompt ?? "";

  configForm.append(
    field("API Key", apiKeyInput),
    field("Base URL", baseUrlInput),
    field("Model", modelInput),
    field("System Prompt", systemPromptInput)
  );

  const messages = document.createElement("div");
  messages.className = `${prefix}__messages`;
  messages.dataset.testId = "nexus-ai-messages";

  const actions = document.createElement("div");
  actions.className = `${prefix}__actions`;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "Clear";
  clear.dataset.testId = "nexus-ai-clear";
  clear.addEventListener("click", () => assistant.clearConversation());
  actions.append(clear);

  const pending = document.createElement("div");
  pending.className = `${prefix}__pending`;
  pending.dataset.testId = "nexus-ai-pending";

  const error = document.createElement("div");
  error.className = `${prefix}__error`;
  error.dataset.testId = "nexus-ai-error";
  error.setAttribute("role", "alert");

  const disabledNotice = document.createElement("div");
  disabledNotice.className = `${prefix}__disabled`;
  disabledNotice.dataset.testId = "nexus-ai-disabled";
  disabledNotice.setAttribute("role", "status");

  const form = document.createElement("form");
  form.className = `${prefix}__composer`;
  const input = document.createElement("textarea");
  input.className = `${prefix}__input`;
  input.dataset.testId = "nexus-ai-input";
  input.placeholder = "Ask AI to inspect or edit this document...";
  input.rows = 3;
  const send = document.createElement("button");
  send.type = "submit";
  send.textContent = "Send";
  send.dataset.testId = "nexus-ai-send";
  form.append(input, send);

  root.append(configForm, messages, actions, pending, error, disabledNotice, form);
  (options.container ?? document.body).appendChild(root);

  let enabled = options.enabled ?? true;
  let disabledMessage = options.disabledMessage ?? "Open a file before using AI assistant.";

  const syncEnabled = () => {
    input.disabled = !enabled;
    send.disabled = !enabled || assistant.getState().loading;
    disabledNotice.textContent = enabled ? "" : disabledMessage;
    disabledNotice.style.display = enabled ? "none" : "";
    input.placeholder = enabled
      ? "Ask AI to inspect or edit this document..."
      : "Open a file to use AI assistant...";
  };

  const syncConfig = () => {
    const next = {
      apiKey: apiKeyInput.value,
      baseUrl: baseUrlInput.value,
      model: modelInput.value,
      systemPrompt: systemPromptInput.value || undefined
    };
    assistant.setConfig(next);
    if (storage && configStorageKey) writeStoredConfig(storage, configStorageKey, next);
  };
  for (const el of [apiKeyInput, baseUrlInput, modelInput, systemPromptInput]) {
    el.addEventListener("input", syncConfig);
  }
  syncConfig();

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!enabled) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    void assistant.sendMessage(text);
  });

  const unsubscribe = assistant.subscribe((state) => {
    send.disabled = !enabled || state.loading;
    send.textContent = state.loading ? "Sending..." : "Send";
    error.textContent = state.error ?? "";
    renderMessages(messages, state.messages, prefix);
    scrollToBottom(messages);
    renderPending(pending, state.pendingOperations, assistant, prefix, options.onApplyOperation);
  });
  syncEnabled();

  return {
    element: root,
    setOpen(open) {
      root.style.display = open ? "" : "none";
    },
    setEnabled(nextEnabled, message) {
      enabled = nextEnabled;
      if (message !== undefined) disabledMessage = message;
      syncEnabled();
    },
    destroy() {
      unsubscribe();
      root.remove();
    }
  };
}

function createInput(type: string, placeholder: string, testId: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.placeholder = placeholder;
  input.dataset.testId = testId;
  return input;
}

function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement("label");
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

function renderMessages(container: HTMLElement, items: readonly { role: string; content: string }[], prefix: string): void {
  container.replaceChildren();
  for (const item of items) {
    if (item.role === "tool") continue;
    const row = document.createElement("div");
    row.className = `${prefix}__message ${prefix}__message--${item.role}`;
    const role = document.createElement("div");
    role.className = `${prefix}__message-role`;
    role.textContent = item.role;
    const content = document.createElement("div");
    content.className = `${prefix}__message-content`;
    content.textContent = item.content;
    row.append(role, content);
    container.appendChild(row);
  }
}

function scrollToBottom(container: HTMLElement): void {
  queueMicrotask(() => {
    container.scrollTop = container.scrollHeight;
  });
}

function renderPending(
  container: HTMLElement,
  operations: readonly AIPendingOperation[],
  assistant: AIAssistantPlugin,
  prefix: string,
  onApplyOperation?: (operationId: string) => void | Promise<void>
): void {
  container.replaceChildren();
  if (operations.length === 0) return;

  const title = document.createElement("div");
  title.className = `${prefix}__pending-title`;
  title.textContent = "Pending changes";
  container.appendChild(title);

  for (const operation of operations) {
    const item = document.createElement("div");
    item.className = `${prefix}__operation`;
    item.dataset.operationId = operation.id;

    const body = document.createElement("pre");
    body.textContent = formatOperation(operation);

    const actions = document.createElement("div");
    const apply = document.createElement("button");
    apply.type = "button";
    apply.textContent = "Apply";
    apply.dataset.testId = "nexus-ai-apply";
    apply.addEventListener("click", () => {
      const applied = assistant.applyOperation(operation.id);
      if (applied) void onApplyOperation?.(operation.id);
    });
    const discard = document.createElement("button");
    discard.type = "button";
    discard.textContent = "Discard";
    discard.dataset.testId = "nexus-ai-discard";
    discard.addEventListener("click", () => assistant.discardOperation(operation.id));
    actions.append(apply, discard);

    item.append(body, actions);
    container.appendChild(item);
  }
}

function formatOperation(operation: AIPendingOperation): string {
  switch (operation.kind) {
    case "replaceRange":
      return `Replace ${operation.from}-${operation.to}\n\nBefore:\n${operation.before}\n\nAfter:\n${operation.after}`;
    case "insertAt":
      return `Insert at ${operation.pos}\n\n${operation.after}`;
    case "replaceSelection":
      return `Replace selection ${operation.selection.anchor}-${operation.selection.head}\n\nBefore:\n${operation.before}\n\nAfter:\n${operation.after}`;
  }
}
