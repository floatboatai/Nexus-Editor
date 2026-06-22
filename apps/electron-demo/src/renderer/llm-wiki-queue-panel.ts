export interface LLMWikiQueuePanelOptions {
  getActiveRawPath(): string | null;
  getState(): LLMWikiStateFile | null;
  submitCurrent(rawPath: string): Promise<void>;
  submitAllDirty(): Promise<void>;
  retryFailed(): Promise<void>;
  openSchema(): Promise<void>;
  onError(message: string): void;
}

export interface LLMWikiQueuePanel {
  element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  update(state: LLMWikiStateFile | null): void;
}

function countByStatus(state: LLMWikiStateFile | null, status: LLMWikiDocumentStatusState): number {
  if (!state) return 0;
  return Object.values(state.documents).filter((doc) => doc.status === status).length;
}

function shortTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function createButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

export function createLLMWikiQueuePanel(options: LLMWikiQueuePanelOptions): LLMWikiQueuePanel {
  const panel = document.createElement("aside");
  panel.className = "llm-wiki-queue-panel";
  panel.style.display = "none";

  const header = document.createElement("div");
  header.className = "llm-wiki-queue-panel__header";
  const title = document.createElement("strong");
  title.textContent = "LLM Wiki Queue";
  const closeButton = createButton("x", () => close());
  header.append(title, closeButton);

  const summary = document.createElement("div");
  summary.className = "llm-wiki-queue-panel__summary";

  const actions = document.createElement("div");
  actions.className = "llm-wiki-queue-panel__actions";
  actions.append(
    createButton("Submit current", () => {
      const rawPath = options.getActiveRawPath();
      if (!rawPath) {
        options.onError("Open a raw document before submitting current.");
        return;
      }
      void options.submitCurrent(rawPath).catch((err) => options.onError(err instanceof Error ? err.message : String(err)));
    }),
    createButton("Submit all dirty", () => {
      void options.submitAllDirty().catch((err) => options.onError(err instanceof Error ? err.message : String(err)));
    }),
    createButton("Retry failed", () => {
      void options.retryFailed().catch((err) => options.onError(err instanceof Error ? err.message : String(err)));
    }),
    createButton("Open schema", () => {
      void options.openSchema().catch((err) => options.onError(err instanceof Error ? err.message : String(err)));
    }),
  );

  const list = document.createElement("div");
  list.className = "llm-wiki-queue-panel__list";

  panel.append(header, summary, actions, list);

  function render(state: LLMWikiStateFile | null): void {
    const total = Object.keys(state?.documents ?? {}).length;
    const issues = state?.projectIssues ?? [];
    summary.textContent = `Dirty: ${countByStatus(state, "dirty")} | Queued: ${countByStatus(state, "queued")} | Submitting: ${countByStatus(state, "submitting")}/4 | Failed: ${countByStatus(state, "failed")} | Parsed: ${countByStatus(state, "parsed")} | Total: ${total} | Issues: ${issues.length}`;
    list.replaceChildren();
    if (issues.length > 0) {
      const issueBox = document.createElement("div");
      issueBox.className = "llm-wiki-queue-panel__issues";
      const issueTitle = document.createElement("strong");
      issueTitle.textContent = "Project issues";
      issueBox.append(issueTitle);
      for (const issue of issues.slice(0, 5)) {
        const item = document.createElement("div");
        item.textContent = `${issue.code}: ${issue.path} - ${issue.message}`;
        issueBox.append(item);
      }
      if (issues.length > 5) {
        const extra = document.createElement("div");
        extra.textContent = `+${issues.length - 5} more`;
        issueBox.append(extra);
      }
      list.append(issueBox);
    }
    const entries = Object.entries(state?.documents ?? {}).sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "llm-wiki-queue-panel__empty";
      empty.textContent = "No raw document status yet.";
      list.append(empty);
      return;
    }
    for (const [rawPath, doc] of entries) {
      const row = document.createElement("div");
      row.className = `llm-wiki-queue-panel__row llm-wiki-queue-panel__row--${doc.status}`;
      const heading = document.createElement("div");
      heading.className = "llm-wiki-queue-panel__row-heading";
      heading.textContent = `${rawPath} - ${doc.status}`;
      const meta = document.createElement("div");
      meta.className = "llm-wiki-queue-panel__row-meta";
      meta.textContent = `updated ${shortTime(doc.updatedAt)} | completed ${shortTime(doc.completedAt)} | pages ${doc.generated.length} | events ${doc.events.length}`;
      row.append(heading, meta);
      if (doc.error) {
        const error = document.createElement("div");
        error.className = "llm-wiki-queue-panel__row-error";
        error.textContent = doc.error;
        row.append(error);
      }
      list.append(row);
    }
  }

  function open(): void {
    panel.style.display = "flex";
    render(options.getState());
  }

  function close(): void {
    panel.style.display = "none";
  }

  render(null);

  return {
    element: panel,
    open,
    close,
    toggle() {
      if (panel.style.display === "none") open();
      else close();
    },
    update: render,
  };
}
