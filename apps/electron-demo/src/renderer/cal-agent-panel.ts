interface CalAgentStatusPayload {
  status: "idle" | "starting" | "ready" | "error";
  url: string;
  message?: string;
}

export interface CalAgentPanel {
  element: HTMLElement;
  setVisible(next: boolean): void;
  setMaximized(next: boolean): void;
  destroy(): void;
}

function buildEmbedUrl(url: string, embedded: boolean): string {
  const parsed = new URL(url);
  if (embedded) {
    parsed.searchParams.set("embed", "1");
  } else {
    parsed.searchParams.delete("embed");
  }
  return parsed.toString();
}

function statusText(status: CalAgentStatusPayload["status"]): string {
  if (status === "starting") return "Starting workbench...";
  if (status === "ready") return "Connected";
  if (status === "error") return "Unavailable";
  return "Idle";
}

export function createCalAgentPanel(): CalAgentPanel {
  const root = document.createElement("section");
  root.className = "cal-agent-panel";

  const header = document.createElement("div");
  header.className = "cal-agent-panel__header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "cal-agent-panel__title-wrap";

  const title = document.createElement("div");
  title.className = "cal-agent-panel__title";
  title.textContent = "Calendar Agent";

  const status = document.createElement("div");
  status.className = "cal-agent-panel__status";

  titleWrap.append(title, status);

  const actions = document.createElement("div");
  actions.className = "cal-agent-panel__actions";

  const retryBtn = document.createElement("button");
  retryBtn.type = "button";
  retryBtn.textContent = "Retry";

  const openBtn = document.createElement("button");
  openBtn.type = "button";
  openBtn.textContent = "Open in Browser";

  actions.append(retryBtn, openBtn);
  header.append(titleWrap, actions);

  const body = document.createElement("div");
  body.className = "cal-agent-panel__body";

  const hint = document.createElement("div");
  hint.className = "cal-agent-panel__hint";
  hint.textContent = "Waiting for CAL-AGENT to become ready...";

  const webview = document.createElement("webview");
  webview.className = "cal-agent-panel__frame";
  webview.setAttribute("partition", "persist:cal-agent");
  webview.setAttribute("allowpopups", "");
  webview.setAttribute("webpreferences", "contextIsolation=yes");

  body.append(hint, webview);
  root.append(header, body);

  let current: CalAgentStatusPayload = {
    status: "idle",
    url: "http://127.0.0.1:3000",
  };
  let maximized = false;
  let unsubscribe: (() => void) | null = null;

  function render(next: CalAgentStatusPayload): void {
    current = next;
    root.dataset.state = next.status;
    status.textContent = statusText(next.status);
    hint.textContent = next.message ?? "";
    hint.style.display = next.status === "ready" ? "none" : "block";

    if (next.status === "ready") {
      const targetUrl = buildEmbedUrl(next.url, maximized);
      const currentSrc = webview.getAttribute("src");
      if (currentSrc !== targetUrl) {
        webview.setAttribute("src", targetUrl);
      }
      webview.style.display = "block";
    } else {
      webview.removeAttribute("src");
      webview.style.display = "none";
    }
  }

  retryBtn.addEventListener("click", () => {
    void window.nexusDemo.calAgent.retry().then(render).catch((error) => {
      render({
        status: "error",
        url: current.url,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  openBtn.addEventListener("click", () => {
    void window.nexusDemo.calAgent.openExternal();
  });

  async function bootstrap(): Promise<void> {
    try {
      render(await window.nexusDemo.calAgent.getStatus());
      render(await window.nexusDemo.calAgent.start());
    } catch (error) {
      render({
        status: "error",
        url: current.url,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  unsubscribe = window.nexusDemo.calAgent.onStatusChange(render);
  void bootstrap();

  return {
    element: root,
    setVisible(next) {
      root.style.display = next ? "" : "none";
    },
    setMaximized(next) {
      maximized = next;
      if (current.status === "ready") {
        webview.setAttribute("src", buildEmbedUrl(current.url, maximized));
      }
    },
    destroy() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}