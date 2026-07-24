import type { EditorAPI } from "@floatboat/nexus-core";

export interface PaletteCommand {
  id: string;
  title: string;
  hotkey?: string;
  icon?: string;
  run: (editor: EditorAPI) => boolean | void;
}

export interface CommandPaletteOptions {
  container?: HTMLElement;
  classPrefix?: string;
  commands: PaletteCommand[];
}

export interface CommandPaletteUI {
  element: HTMLElement;
  open(): void;
  close(): void;
  destroy(): void;
}

const PREFIX = "nexus-palette";

export function createCommandPalette(
  editor: EditorAPI,
  options: CommandPaletteOptions
): CommandPaletteUI {
  const prefix = options.classPrefix ?? PREFIX;
  const container = options.container ?? document.body;
  const commands = options.commands;

  const backdrop = document.createElement("div");
  backdrop.className = prefix + "-backdrop";
  Object.assign(backdrop.style, {
    position: "fixed", inset: "0", zIndex: "10000", display: "none",
    alignItems: "flex-start", justifyContent: "center", paddingTop: "15vh",
    background: "rgba(0,0,0,0.35)", fontFamily: "system-ui,-apple-system,sans-serif",
  });

  const dialog = document.createElement("div");
  dialog.className = prefix + "-dialog";
  Object.assign(dialog.style, {
    width: "560px", maxWidth: "90vw", background: "var(--nexus-bg,#fff)",
    border: "1px solid var(--nexus-border,#e4e7eb)", borderRadius: "12px",
    boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden",
    display: "flex", flexDirection: "column",
  });

  const inputWrap = document.createElement("div");
  Object.assign(inputWrap.style, {
    display: "flex", alignItems: "center", gap: "8px", padding: "14px 16px",
    borderBottom: "1px solid var(--nexus-border,#e4e7eb)",
  });

  const iconEl = document.createElement("span");
  iconEl.textContent = ">";
  Object.assign(iconEl.style, {
    fontSize: "14px", flexShrink: "0", color: "var(--nexus-text-muted,#888)",
  });

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type a command...";
  Object.assign(input.style, {
    flex: "1", border: "none", outline: "none", fontSize: "15px",
    lineHeight: "1.4", background: "transparent", color: "var(--nexus-text,#24292e)",
  });

  const list = document.createElement("div");
  Object.assign(list.style, {
    maxHeight: "300px", overflowY: "auto", padding: "4px",
  });

  inputWrap.append(iconEl, input);
  dialog.append(inputWrap, list);
  backdrop.appendChild(dialog);
  container.appendChild(backdrop);

  let highlight = 0;
  let filtered: PaletteCommand[] = [];
  let destroyed = false;

  function doFilter(query: string): PaletteCommand[] {
    if (!query) return commands;
    const lower = query.toLowerCase();
    return commands.filter((c) => c.title.toLowerCase().includes(lower));
  }

  function syncHighlight(): void {
    const items = list.querySelectorAll("." + prefix + "-item");
    items.forEach((el, i) => {
      const htmlEl = el as HTMLElement;
      if (i === highlight) {
        htmlEl.classList.add("is-active");
        htmlEl.style.background = "var(--nexus-bg-muted,#eaeef2)";
        htmlEl.scrollIntoView({ block: "nearest" });
      } else {
        htmlEl.classList.remove("is-active");
        htmlEl.style.background = "";
      }
    });
  }

  function executeCmd(): void {
    if (filtered.length === 0 || highlight < 0 || highlight >= filtered.length) return;
    close();
    filtered[highlight].run(editor);
  }

  function render(): void {
    list.innerHTML = "";
    for (let i = 0; i < filtered.length; i++) {
      const cmd = filtered[i];
      const row = document.createElement("div");
      row.className = prefix + "-item";
      if (i === highlight) row.classList.add("is-active");
      Object.assign(row.style, {
        display: "flex", alignItems: "center", gap: "10px",
        padding: "8px 12px", borderRadius: "6px", cursor: "pointer",
        color: "var(--nexus-text,#24292e)", fontSize: "14px", lineHeight: "1.4",
        background: i === highlight ? "var(--nexus-bg-muted,#eaeef2)" : "",
      });

      const iconSpan = document.createElement("span");
      iconSpan.textContent = cmd.icon ?? ">";
      Object.assign(iconSpan.style, {
        fontSize: "14px", width: "22px", textAlign: "center", flexShrink: "0",
      });

      const title = document.createElement("span");
      title.textContent = cmd.title;
      title.style.flex = "1";

      const hotkey = document.createElement("span");
      hotkey.textContent = cmd.hotkey ?? "";
      Object.assign(hotkey.style, {
        fontSize: "12px", color: "var(--nexus-text-muted,#888)",
        fontFamily: "ui-monospace,monospace", flexShrink: "0",
      });

      row.append(iconSpan, title, hotkey);
      const idx = i;
      row.addEventListener("mousedown", (e) => e.preventDefault());
      row.addEventListener("click", (e) => {
        e.preventDefault();
        highlight = idx;
        executeCmd();
      });
      row.addEventListener("mouseenter", () => {
        highlight = idx;
        syncHighlight();
      });
      list.appendChild(row);
    }

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No commands found";
      Object.assign(empty.style, {
        padding: "16px", textAlign: "center",
        color: "var(--nexus-text-muted,#888)", fontStyle: "italic",
      });
      list.appendChild(empty);
    }
  }

  input.addEventListener("input", () => {
    filtered = doFilter(input.value);
    highlight = 0;
    render();
  });

  input.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (filtered.length > 0) {
          highlight = (highlight + 1) % filtered.length;
          syncHighlight();
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (filtered.length > 0) {
          highlight = (highlight - 1 + filtered.length) % filtered.length;
          syncHighlight();
        }
        break;
      case "Enter":
        e.preventDefault();
        executeCmd();
        break;
      case "Escape":
        e.preventDefault();
        close();
        break;
    }
  });

  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
  });

  function open(): void {
    if (destroyed) return;
    filtered = commands;
    highlight = 0;
    input.value = "";
    backdrop.style.display = "flex";
    render();
    requestAnimationFrame(() => input.focus());
  }

  function close(): void {
    backdrop.style.display = "none";
  }

  return {
    element: backdrop,
    open,
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    },
  };
}
