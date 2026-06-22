export interface AskWikiPanelOptions {
  getProjectPath(): string | null;
  ask(input: LLMWikiAskInput): Promise<LLMWikiAskResult>;
  onError(message: string): void;
}

export interface AskWikiPanel {
  element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
}

function appendMessage(
  messages: HTMLElement,
  kind: "question" | "answer" | "error",
  text: string
): HTMLElement {
  const message = document.createElement("div");
  message.className = `ask-wiki-panel__message ask-wiki-panel__message--${kind}`;
  message.textContent = text;
  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;
  return message;
}

function appendCitations(parent: HTMLElement, citations: LLMWikiCitation[]): void {
  if (citations.length === 0) return;

  const list = document.createElement("ul");
  for (const citation of citations) {
    const item = document.createElement("li");
    item.textContent = citation.quote
      ? `${citation.path}: ${citation.quote}`
      : citation.path;
    list.appendChild(item);
  }
  parent.appendChild(list);
}

export function createAskWikiPanel(options: AskWikiPanelOptions): AskWikiPanel {
  const panel = document.createElement("aside");
  panel.className = "ask-wiki-panel";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "ask-wiki-panel__header";

  const title = document.createElement("span");
  title.textContent = "Ask Wiki";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "×";
  closeButton.title = "Close Ask Wiki";

  header.append(title, closeButton);

  const messages = document.createElement("div");
  messages.className = "ask-wiki-panel__messages";

  const form = document.createElement("form");
  form.className = "ask-wiki-panel__form";

  const input = document.createElement("textarea");
  input.placeholder = "Ask about the compiled wiki";
  input.rows = 4;

  const askButton = document.createElement("button");
  askButton.type = "submit";
  askButton.textContent = "Ask";

  form.append(input, askButton);
  panel.append(header, messages, form);

  function open(): void {
    panel.style.display = "flex";
    input.focus();
  }

  function close(): void {
    panel.style.display = "none";
  }

  closeButton.addEventListener("click", close);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    appendMessage(messages, "question", question);
    input.value = "";
    askButton.disabled = true;
    askButton.textContent = "Asking...";

    const projectPath = options.getProjectPath();
    void options.ask({ projectPath, question })
      .then((result) => {
        if (!result.ok) {
          throw new Error(result.error || "Ask Wiki failed.");
        }
        const answer = appendMessage(messages, "answer", result.answer);
        appendCitations(answer, result.citations);
        messages.scrollTop = messages.scrollHeight;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        appendMessage(messages, "error", message);
        options.onError(message);
      })
      .finally(() => {
        askButton.disabled = false;
        askButton.textContent = "Ask";
        input.focus();
      });
  });

  return {
    element: panel,
    open,
    close,
    toggle() {
      if (panel.style.display === "none") {
        open();
      } else {
        close();
      }
    },
  };
}
