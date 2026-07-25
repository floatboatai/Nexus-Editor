export {};

import { connectNexusIframe, type NexusIframeController } from "../src/iframe-parent";

const logElement = document.querySelector<HTMLPreElement>("#log")!;

function log(name: string, pass: boolean, detail: string): void {
  const line = document.createElement("div");
  line.className = pass ? "pass" : "fail";
  line.textContent = `${pass ? "PASS" : "FAIL"} ${name}: ${detail}`;
  logElement.prepend(line);
}

async function main(): Promise<void> {
  // Create and configure this element before the class is registered. This is
  // the loading order used by lazy framework bundles and exercises property replay.
  const preUpgrade = document.createElement("nexus-editor") as HTMLElement & { value?: string };
  preUpgrade.value = "# property before upgrade";
  document.querySelector("#pre-upgrade")!.append(preUpgrade);

  const { defineNexusEditor } = await import("../src/index");
  defineNexusEditor();

  type ManualEditor = HTMLElement & {
    value?: string;
    editor: import("@floatboat/nexus-core").EditorAPI | null;
  };

  const moveEditor = document.createElement("nexus-editor") as ManualEditor;
  moveEditor.setAttribute("initial-value", "uncontrolled seed");
  document.querySelector("#parent-a")!.append(moveEditor);

  const controlled = document.createElement("nexus-editor") as ManualEditor;
  controlled.setAttribute("parse-delay-ms", "300");
  controlled.value = "A";
  controlled.addEventListener("nexus-change", (event) => {
    controlled.value = event.detail.doc;
  });
  document.querySelector("#controlled-mount")!.append(controlled);

  const shadowHost = document.querySelector<HTMLElement>("#shadow-host")!;
  const shadowRoot = shadowHost.attachShadow({ mode: "open" });
  shadowRoot.innerHTML = `<style>nexus-editor{min-height:130px}</style><nexus-editor></nexus-editor>`;
  const shadowEditor = shadowRoot.querySelector("nexus-editor") as ManualEditor;
  shadowHost.addEventListener("nexus-change", () => {
    log("WC-05", true, "nexus-change 已穿过 Shadow DOM");
  }, { once: true });

  const multiEditor = document.createElement("nexus-editor") as ManualEditor;
  multiEditor.setAttribute("initial-value", "alpha bravo");
  multiEditor.setAttribute("multi-cursor", "");
  document.querySelector("#multi-mount")!.append(multiEditor);

  const iframe = document.querySelector<HTMLIFrameElement>("#editor-frame")!;
  const requestedFrameOrigin = new URLSearchParams(window.location.search).get("frameOrigin");
  const frameOrigin = requestedFrameOrigin ?? window.location.origin;
  const frameUrl = new URL("/frame.html", frameOrigin);
  frameUrl.searchParams.set("parentOrigin", window.location.origin);
  let iframeController: NexusIframeController | null = null;

  async function connectFrame(): Promise<void> {
    iframeController?.destroy();
    const controller = connectNexusIframe(iframe, { targetOrigin: frameOrigin, timeoutMs: 2_000 });
    iframeController = controller;
    controller.onChange((doc) => log("IFRAME-02", true, `change=${JSON.stringify(doc)}`));
    try {
      await controller.ready;
      log("IFRAME-01", true, `ready from ${frameOrigin}`);
    } catch (error) {
      log("IFRAME-01", false, error instanceof Error ? error.message : String(error));
    }
  }

  iframe.addEventListener("load", () => {
    if (!iframeController) void connectFrame();
  });
  iframe.src = frameUrl.href;

  document.querySelector("#check-pre-upgrade")!.addEventListener("click", () => {
    const actual = (preUpgrade as ManualEditor).editor?.getDocument();
    log("WC-02", actual === "# property before upgrade", `document=${JSON.stringify(actual)}`);
  });

  document.querySelector("#move-editor")!.addEventListener("click", () => {
    const before = moveEditor.editor?.getDocument();
    const target = moveEditor.parentElement?.id === "parent-a" ? "#parent-b" : "#parent-a";
    document.querySelector(target)!.append(moveEditor);
    const after = moveEditor.editor?.getDocument();
    log("WC-04", before === after, `before=${JSON.stringify(before)}, after=${JSON.stringify(after)}`);
  });

  document.querySelector("#run-controlled-race")!.addEventListener("click", () => {
    controlled.value = "A";
    controlled.editor?.setDocument("B");
    window.setTimeout(() => { controlled.value = "C"; }, 30);
    window.setTimeout(() => {
      const doc = controlled.editor?.getDocument();
      log("WC-03", controlled.value === "C" && doc === "C", `value=${controlled.value}, document=${doc}`);
    }, 380);
  });

  document.querySelector("#edit-shadow")!.addEventListener("click", () => {
    shadowEditor.editor?.setDocument(`shadow edit ${Date.now()}`);
  });

  document.querySelector("#check-multi")!.addEventListener("click", () => {
    multiEditor.editor?.setSelections([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);
    const count = multiEditor.editor?.getSelections().ranges.length;
    log("WC-06", count === 2, `selection ranges=${count}`);
  });

  document.querySelector("#iframe-set")!.addEventListener("click", async () => {
    try {
      const value = `# parent update\n\n${new Date().toISOString()}`;
      await iframeController?.setDocument(value);
      log("IFRAME-03", true, `set=${JSON.stringify(value)}`);
    } catch (error) {
      log("IFRAME-03", false, error instanceof Error ? error.message : String(error));
    }
  });

  document.querySelector("#iframe-get")!.addEventListener("click", async () => {
    try {
      const value = await iframeController?.getDocument();
      log("IFRAME-04", typeof value === "string", `get=${JSON.stringify(value)}`);
    } catch (error) {
      log("IFRAME-04", false, error instanceof Error ? error.message : String(error));
    }
  });

  document.querySelector("#iframe-focus")!.addEventListener("click", async () => {
    try {
      await iframeController?.focus();
      log("IFRAME-05", true, "focus request completed");
    } catch (error) {
      log("IFRAME-05", false, error instanceof Error ? error.message : String(error));
    }
  });

  document.querySelector("#iframe-reload")!.addEventListener("click", () => {
    const reloadUrl = new URL(frameUrl);
    reloadUrl.searchParams.set("reload", Date.now().toString());
    iframe.src = reloadUrl.href;
    window.setTimeout(async () => {
      try {
        await iframeController?.getDocument();
        log("IFRAME-06", false, "old controller unexpectedly survived reload");
      } catch (error) {
        const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
        log("IFRAME-06", code === "IFRAME_RELOADED", `error code=${code}`);
      }
    }, 250);
  });

  document.querySelector("#iframe-reconnect")!.addEventListener("click", () => {
    iframeController?.destroy();
    iframeController = null;
    const reconnectUrl = new URL(frameUrl);
    reconnectUrl.searchParams.set("reconnect", Date.now().toString());
    iframe.src = reconnectUrl.href;
  });

  document.querySelector("#iframe-wrong-origin")!.addEventListener("click", async () => {
    const wrong = connectNexusIframe(iframe, {
      targetOrigin: "https://wrong-origin.invalid",
      timeoutMs: 500,
    });
    try {
      await wrong.ready;
      log("IFRAME-07", false, "wrong origin connected");
    } catch (error) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "unknown";
      log("IFRAME-07", code === "TIMEOUT", `error code=${code}`);
    } finally {
      wrong.destroy();
    }
  });

  document.querySelector("#iframe-destroy")!.addEventListener("click", () => {
    iframeController?.destroy();
    iframeController = null;
    log("IFRAME-08", true, "controller destroyed; reload the frame before reconnecting");
  });
}

void main();
