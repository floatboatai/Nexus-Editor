import { boot } from "./app";

async function startRenderer(): Promise<void> {
  const bridge = window.nexusPublicCapabilities;
  const app = await boot({ publicCapabilitiesManaged: Boolean(bridge) });
  if (!bridge || !window.nexusPlugins) return;

  const { bootPublicCapabilitiesDemo } = await import("./public-capabilities-demo");
  const panel = document.createElement("aside");
  panel.className = "public-capabilities-launcher";
  panel.id = "public-capabilities-launcher";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "public-capabilities-title");
  panel.style.cssText = "position:fixed;z-index:1000;top:48px;right:12px;width:min(760px,calc(100vw - 24px));height:min(calc(90vh - 48px),852px);display:flex;flex-direction:column;background:var(--nexus-bg,#fff);color:var(--nexus-text,#24292e);border:1px solid var(--nexus-border,#d0d7de);border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.22);overflow:auto";
  const chrome = document.createElement("div");
  chrome.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 12px;flex-shrink:0;border-bottom:1px solid var(--nexus-border,#d0d7de);font-weight:600";
  const label = document.createElement("span");
  label.id = "public-capabilities-title";
  label.textContent = "公共能力";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "收起";
  close.setAttribute("aria-label", "收起公共能力");
  chrome.append(label, close);
  document.body.append(panel);

  let demo: import("./public-capabilities-demo").PublicCapabilitiesDemo | null = null;
  let shutdownPending = false;
  const handleShutdown = async (): Promise<void> => {
    if (!demo) {
      shutdownPending = true;
      return;
    }
    if (app?.state?.dirty && !window.confirm("原编辑器有未保存内容，确认放弃并关闭？")) {
      await bridge.cancelShutdown();
      return;
    }
    const closed = await demo.requestShutdown();
    if (closed) await app?.shutdown();
  };
  if (window.nexusHost) window.nexusHost.onShutdown(() => { void handleShutdown(); });
  try {
    demo = await bootPublicCapabilitiesDemo({
      root: panel,
      bridge,
      plugins: { vault: window.nexusPlugins.vault },
      manageShutdown: false,
    });
    panel.insertBefore(chrome, panel.firstChild);
  } catch (error) {
    panel.remove();
    await app.shutdown();
    throw error;
  }
  if (shutdownPending) void handleShutdown();

  const setPanelVisible = (visible: boolean): void => {
    panel.hidden = !visible;
    // The panel uses an inline flex layout; the inline display value otherwise
    // overrides the browser's default `[hidden] { display: none }` rule.
    panel.style.display = visible ? "flex" : "none";
    trigger?.setAttribute("aria-expanded", String(visible));
  };
  const trigger = document.querySelector<HTMLButtonElement>("[aria-label='公共能力']");
  trigger?.setAttribute("aria-controls", panel.id);
  trigger?.setAttribute("aria-expanded", "true");
  setPanelVisible(true);
  close.addEventListener("click", () => {
    setPanelVisible(false);
    trigger?.focus();
  });
  window.addEventListener("nexus:toggle-public-capabilities", () => {
    setPanelVisible(panel.hidden);
    if (!panel.hidden) close.focus();
  });

}

void startRenderer().catch((error) => {
  console.error("Nexus renderer failed to start", error);
});
