import { mountNexusIframeRuntime } from "../src/iframe-runtime";

const parentOrigin = new URLSearchParams(window.location.search).get("parentOrigin");
if (!parentOrigin) throw new Error("Missing parentOrigin query parameter.");

mountNexusIframeRuntime({
  container: document.querySelector<HTMLElement>("#editor")!,
  allowedParentOrigin: parentOrigin,
  editorConfig: {
    initialValue: "# iframe runtime\n\nEdit this text to test parent change events.",
    livePreview: true,
  },
});
