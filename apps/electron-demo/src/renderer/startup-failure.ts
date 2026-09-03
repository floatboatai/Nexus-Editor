export const RENDERER_STARTUP_FAILURE_CODE = "renderer-startup-failed";

export function renderStartupFailure(
  _cause: unknown = undefined,
  targetDocument: Document = document,
): void {
  // Startup failures can contain URLs, credentials, or private document text.
  // Accept the rejection value only so callers can safely hand it off; never
  // derive user-visible diagnostics from it.
  void _cause;
  const existingRoot = targetDocument.querySelector<HTMLElement>("#app");
  const root = existingRoot ?? targetDocument.createElement("div");
  if (!existingRoot) {
    root.id = "app";
    (targetDocument.body ?? targetDocument.documentElement).append(root);
  }
  root.dataset.nexusStartupState = "failed";

  const surface = targetDocument.createElement("main");
  surface.className = "startup-failure";
  surface.dataset.nexusStartupFailure = "true";
  surface.setAttribute("role", "alert");

  const title = targetDocument.createElement("h1");
  title.textContent = "Nexus Editor could not start";

  const guidance = targetDocument.createElement("p");
  guidance.textContent =
    "Close this window and restart the Electron client. If the problem continues, copy the error code below.";

  const label = targetDocument.createElement("strong");
  label.textContent = "Error code";

  const diagnostic = targetDocument.createElement("pre");
  diagnostic.textContent = RENDERER_STARTUP_FAILURE_CODE;

  surface.append(title, guidance, label, diagnostic);
  root.replaceChildren(surface);
}
