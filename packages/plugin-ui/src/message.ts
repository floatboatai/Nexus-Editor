export type MessageType = "success" | "warning" | "error" | "info";

export interface MessageConfig {
  type?: MessageType;
  duration?: number;
  closable?: boolean;
}

const ICONS: Record<MessageType, string> = {
  success: "✓",
  warning: "⚠",
  error: "✕",
  info: "ℹ",
};

const STYLES: Record<MessageType, { bg: string; color: string; borderColor: string }> = {
  success: { bg: "rgba(26, 127, 55, 0.08)", color: "#1a7f37", borderColor: "#1a7f37" },
  warning: { bg: "rgba(154, 103, 0, 0.08)", color: "#9a6700", borderColor: "#9a6700" },
  error: { bg: "rgba(207, 34, 46, 0.08)", color: "#cf222e", borderColor: "#cf222e" },
  info: { bg: "rgba(9, 105, 218, 0.08)", color: "#0969da", borderColor: "#0969da" },
};

const containerId = "nexus-message-container";

function getContainer(): HTMLElement {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement("div");
    container.id = containerId;
    container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(container);
  }
  return container;
}

function createMessageElement(content: string, type: MessageType, closable: boolean): HTMLElement {
  const style = STYLES[type];
  const icon = ICONS[type];

  const element = document.createElement("div");
  element.style.cssText = `
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: ${style.bg};
    border: 1px solid ${style.borderColor};
    border-radius: 8px;
    color: ${style.color};
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    min-width: 280px;
    max-width: 400px;
    animation: slideIn 0.3s ease-out;
  `;

  const iconSpan = document.createElement("span");
  iconSpan.textContent = icon;
  iconSpan.style.fontSize = "16px";
  element.appendChild(iconSpan);

  const textSpan = document.createElement("span");
  textSpan.textContent = content;
  textSpan.style.flex = "1";
  element.appendChild(textSpan);

  if (closable) {
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: ${style.color};
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      line-height: 1;
      opacity: 0.7;
      transition: opacity 0.2s;
    `;
    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.opacity = "1";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.opacity = "0.7";
    });
    closeBtn.addEventListener("click", () => {
      removeMessage(element);
    });
    element.appendChild(closeBtn);
  }

  return element;
}

function removeMessage(element: HTMLElement): void {
  element.style.animation = "slideOut 0.2s ease-in forwards";
  setTimeout(() => {
    element.remove();
  }, 200);
}

function showMessage(content: string, config: MessageConfig = {}): void {
  const { type = "info", duration = 3000, closable = true } = config;
  
  const element = createMessageElement(content, type, closable);
  const container = getContainer();
  container.appendChild(element);

  if (duration > 0) {
    setTimeout(() => {
      removeMessage(element);
    }, duration);
  }
}

export const message = {
  success(content: string, config?: Omit<MessageConfig, "type">): void {
    injectStyles();
    showMessage(content, { ...config, type: "success" });
  },
  warning(content: string, config?: Omit<MessageConfig, "type">): void {
    injectStyles();
    showMessage(content, { ...config, type: "warning" });
  },
  error(content: string, config?: Omit<MessageConfig, "type">): void {
    injectStyles();
    showMessage(content, { ...config, type: "error" });
  },
  info(content: string, config?: Omit<MessageConfig, "type">): void {
    injectStyles();
    showMessage(content, { ...config, type: "info" });
  },
};

// 懒加载动画样式，避免 SSR/Node 环境报错
let styleInjected = false;
function injectStyles(): void {
  if (styleInjected || typeof document === 'undefined') return;
  const styleSheet = document.createElement("style");
  styleSheet.textContent = `
  @keyframes slideIn {
    from {
      opacity: 0;
      transform: translateX(100%);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  @keyframes slideOut {
    from {
      opacity: 1;
      transform: translateX(0);
    }
    to {
      opacity: 0;
      transform: translateX(100%);
    }
  }
`;
  document.head.appendChild(styleSheet);
  styleInjected = true;
}
