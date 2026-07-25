import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as coreModule from "@floatboat/nexus-core";
import type { NexusLocale, NexusPlugin, NexusTheme } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

import { defineNexusEditor, NexusEditorElement } from "../src/index";
import type {
  NexusChangeDetail,
  NexusReadyDetail,
  NexusSelectionChangeDetail,
  NexusSlashMenuChangeDetail,
} from "../src/types";

defineNexusEditor();

describe("defineNexusEditor", () => {
  it("registers the <nexus-editor> custom element", () => {
    expect(customElements.get("nexus-editor")).toBe(NexusEditorElement);
  });

  it("is idempotent when called more than once", () => {
    expect(() => defineNexusEditor()).not.toThrow();
    expect(() => defineNexusEditor()).not.toThrow();
  });

  it("keeps the existing registration when re-registering its own tag name", () => {
    expect(() => defineNexusEditor("nexus-editor")).not.toThrow();
    expect(customElements.get("nexus-editor")).toBe(NexusEditorElement);
  });

  it("throws when a tag name belongs to a different custom element", () => {
    const tagName = "foreign-nexus-editor";
    customElements.define(tagName, class extends HTMLElement {});

    expect(() => defineNexusEditor(tagName)).toThrow(/already registered/i);
  });

});

describe("NexusEditorElement", () => {
  let host: NexusEditorElement;

  beforeEach(() => {
    host = document.createElement("nexus-editor") as NexusEditorElement;
  });

  afterEach(async () => {
    host.remove();
    await Promise.resolve();
    vi.useRealTimers();
  });

  it("mounts a core editor instance on connect and fires nexus-ready", async () => {
    let ready: NexusReadyDetail | null = null;
    host.addEventListener("nexus-ready", ((event: CustomEvent<NexusReadyDetail>) => {
      ready = event.detail;
    }) as EventListener);

    host.setAttribute("initial-value", "# Hello");
    document.body.appendChild(host);

    expect(host.editor).not.toBeNull();
    expect(host.querySelector(".cm-editor")).not.toBeNull();

    await Promise.resolve();
    expect(ready).not.toBeNull();
    expect(ready!.editor).toBe(host.editor);
  });

  it("delivers nexus-ready to a listener attached right after append", async () => {
    const onReady = vi.fn();
    document.body.appendChild(host);
    // The README's imperative pattern: subscribe after insertion. A synchronous
    // dispatch inside connectedCallback would already have missed this.
    host.addEventListener("nexus-ready", onReady);

    await Promise.resolve();

    expect(onReady).toHaveBeenCalledOnce();
  });

  it("delivers nexus-ready for declarative markup upgraded by defineNexusEditor", async () => {
    const tagName = "ready-nexus-editor";
    const holder = document.createElement("div");
    holder.innerHTML = `<${tagName} initial-value="# Hello"></${tagName}>`;
    document.body.append(holder);

    const el = holder.firstElementChild as NexusEditorElement;
    const onReady = vi.fn();
    customElements.define(tagName, class extends NexusEditorElement {});
    // Upgrade already ran synchronously inside define(); the microtask dispatch
    // is what makes this post-define subscription work.
    el.addEventListener("nexus-ready", onReady);

    await Promise.resolve();

    expect(onReady).toHaveBeenCalledOnce();
    expect(el.editor!.getDocument()).toBe("# Hello");
    holder.remove();
  });

  it("does not fire nexus-ready after an immediate disconnect", async () => {
    const onReady = vi.fn();
    document.body.appendChild(host);
    host.addEventListener("nexus-ready", onReady);
    host.remove();

    await Promise.resolve();
    await Promise.resolve();

    expect(onReady).not.toHaveBeenCalled();
  });

  it("destroys the editor and removes the container on disconnect", async () => {
    document.body.appendChild(host);
    const editor = host.editor;
    expect(editor).not.toBeNull();

    const destroySpy = vi.spyOn(editor!, "destroy");
    host.remove();
    await Promise.resolve();

    expect(destroySpy).toHaveBeenCalledOnce();
    expect(host.editor).toBeNull();
    expect(host.querySelector(".cm-editor")).toBeNull();
  });

  it("preserves uncontrolled edits when synchronously reparented", () => {
    const firstParent = document.createElement("div");
    const secondParent = document.createElement("div");
    document.body.append(firstParent, secondParent);
    host.setAttribute("initial-value", "seed");
    firstParent.append(host);
    host.editor!.setDocument("unsaved edit");

    secondParent.append(host);

    expect(host.editor!.getDocument()).toBe("unsaved edit");
    firstParent.remove();
    secondParent.remove();
  });

  it("uses initial-value for uncontrolled documents", () => {
    host.setAttribute("initial-value", "uncontrolled");
    document.body.appendChild(host);

    expect(host.editor!.getDocument()).toBe("uncontrolled");
  });

  it("prefers the value property over initial-value when both are set", () => {
    host.setAttribute("initial-value", "seed");
    host.value = "controlled-start";
    document.body.appendChild(host);

    expect(host.editor!.getDocument()).toBe("controlled-start");
  });

  it("syncs the document when the value property changes after connect", () => {
    host.value = "first";
    document.body.appendChild(host);
    expect(host.editor!.getDocument()).toBe("first");

    host.value = "second";
    expect(host.editor!.getDocument()).toBe("second");
  });

  it("syncs the document when the value attribute changes after connect", () => {
    host.setAttribute("value", "first");
    document.body.appendChild(host);
    expect(host.editor!.getDocument()).toBe("first");

    host.setAttribute("value", "second");
    expect(host.editor!.getDocument()).toBe("second");
  });

  it("does not re-apply a controlled value that already matches the last change", () => {
    host.value = "start";
    document.body.appendChild(host);

    const setDocumentSpy = vi.spyOn(host.editor!, "setDocument");
    host.value = "start";

    expect(setDocumentSpy).not.toHaveBeenCalled();
  });

  it("keeps a newer controlled value when an older delayed change was pending", () => {
    vi.useFakeTimers();
    host.setAttribute("parse-delay-ms", "20");
    host.value = "A";
    host.addEventListener("nexus-change", ((event: CustomEvent<NexusChangeDetail>) => {
      host.value = event.detail.doc;
    }) as EventListener);
    document.body.appendChild(host);

    host.editor!.setDocument("B");
    host.value = "C";
    vi.advanceTimersByTime(20);

    expect(host.value).toBe("C");
    expect(host.editor!.getDocument()).toBe("C");
  });

  it("keeps the outer controlled value when a table flush emits reentrantly", () => {
    const initial = "| A | B |\n| --- | --- |\n| old | 2 |";
    host.value = initial;
    host.livePreview = true;
    host.plugins = [createGfmPreset()];
    host.addEventListener("nexus-change", ((event: CustomEvent<NexusChangeDetail>) => {
      host.value = event.detail.doc;
    }) as EventListener);
    document.body.append(host);

    const cell = host.querySelectorAll<HTMLElement>("tr")[2]?.querySelectorAll<HTMLElement>(".nexus-cell")[0];
    expect(cell).not.toBeUndefined();
    document.getSelection()?.removeAllRanges();
    cell!.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 80,
      clientY: 40,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 80,
      clientY: 40,
    }));
    cell!.textContent = "edited";
    cell!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "edited" }));

    host.value = "replacement";

    expect(host.value).toBe("replacement");
    expect(host.editor!.getDocument()).toBe("replacement");
  });

  it("restores an outer controlled value attribute after a reentrant table flush", () => {
    const initial = "| A | B |\n| --- | --- |\n| old | 2 |";
    host.setAttribute("value", initial);
    host.livePreview = true;
    host.plugins = [createGfmPreset()];
    host.addEventListener("nexus-change", ((event: CustomEvent<NexusChangeDetail>) => {
      host.setAttribute("value", event.detail.doc);
    }) as EventListener);
    document.body.append(host);

    const cell = host.querySelectorAll<HTMLElement>("tr")[2]?.querySelectorAll<HTMLElement>(".nexus-cell")[0];
    expect(cell).not.toBeUndefined();
    document.getSelection()?.removeAllRanges();
    cell!.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 80,
      clientY: 40,
    }));
    document.dispatchEvent(new MouseEvent("mouseup", {
      bubbles: true,
      button: 0,
      clientX: 80,
      clientY: 40,
    }));
    cell!.textContent = "edited";
    cell!.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "edited" }));

    host.setAttribute("value", "replacement");

    expect(host.value).toBe("replacement");
    expect(host.getAttribute("value")).toBe("replacement");
    expect(host.editor!.getDocument()).toBe("replacement");
  });

  it("honors properties assigned before custom-element upgrade", () => {
    const tagName = "late-nexus-editor";
    const lateHost = document.createElement(tagName) as NexusEditorElement;
    lateHost.value = "before-upgrade";
    document.body.append(lateHost);

    customElements.define(tagName, class extends NexusEditorElement {});

    expect(lateHost.editor!.getDocument()).toBe("before-upgrade");
    lateHost.remove();
  });

  it("forwards document changes via nexus-change", () => {
    const onChange = vi.fn();
    host.addEventListener("nexus-change", ((event: CustomEvent<NexusChangeDetail>) => {
      onChange(event.detail);
    }) as EventListener);

    document.body.appendChild(host);
    host.editor!.setDocument("edited");

    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls.at(-1)?.[0]?.doc).toBe("edited");
  });

  it("composes public events across a consumer-owned shadow root", () => {
    const outer = document.createElement("div");
    const shadow = outer.attachShadow({ mode: "open" });
    const onChange = vi.fn();
    outer.addEventListener("nexus-change", onChange);
    document.body.append(outer);
    shadow.append(host);

    host.editor!.setDocument("edited in shadow");

    expect(onChange).toHaveBeenCalledOnce();
    outer.remove();
  });

  it("forwards selection updates via nexus-selectionchange", () => {
    const onSelectionChange = vi.fn();
    host.addEventListener("nexus-selectionchange", ((event: CustomEvent<NexusSelectionChangeDetail>) => {
      onSelectionChange(event.detail);
    }) as EventListener);

    host.setAttribute("initial-value", "alpha bravo charlie");
    document.body.appendChild(host);

    host.editor!.setSelection(0, 5);

    expect(onSelectionChange).toHaveBeenCalled();
    const detail = onSelectionChange.mock.calls.at(-1)?.[0];
    expect(detail).toMatchObject({ anchor: 0, head: 5 });
  });

  it("forwards slash-menu updates via nexus-slashmenuchange", () => {
    const slashPlugin: NexusPlugin = {
      name: "test-slash",
      slashCommands: [{ id: "test", title: "Test command" }],
    };
    host.plugins = [slashPlugin];

    const onSlashMenuChange = vi.fn();
    host.addEventListener("nexus-slashmenuchange", ((event: CustomEvent<NexusSlashMenuChangeDetail>) => {
      onSlashMenuChange(event.detail);
    }) as EventListener);

    host.setAttribute("initial-value", "");
    document.body.appendChild(host);

    host.editor!.setDocument("/");
    host.editor!.setSelection(1, 1);

    expect(onSlashMenuChange).toHaveBeenCalled();
  });

  it("applies the read-only attribute at connect time", () => {
    host.setAttribute("initial-value", "locked");
    host.setAttribute("read-only", "");
    document.body.appendChild(host);

    expect(host.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
  });

  it("exposes readOnly as a reflected property", () => {
    expect(host.readOnly).toBe(false);
    host.readOnly = true;
    expect(host.hasAttribute("read-only")).toBe(true);
  });

  it("enables multi-cursor from the reflected property at connect time", () => {
    host.setAttribute("initial-value", "alpha bravo");
    host.multiCursor = true;
    document.body.append(host);

    host.editor!.setSelections([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);

    expect(host.hasAttribute("multi-cursor")).toBe(true);
    expect(host.editor!.getSelections().ranges).toHaveLength(2);
  });

  it("keeps the live editor editable when read-only is set after connect", () => {
    host.setAttribute("initial-value", "editable");
    document.body.appendChild(host);
    const editor = host.editor;

    host.readOnly = true;

    // Initial-only config parity with packages/react: no live reconfiguration.
    expect(host.editor).toBe(editor);
    expect(host.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("true");
  });

  it("forwards focus and blur as composed nexus events", () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    host.addEventListener("nexus-focus", onFocus);
    host.addEventListener("nexus-blur", onBlur);
    host.setAttribute("initial-value", "focus me");
    document.body.appendChild(host);

    host.editor!.focus();
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onFocus.mock.calls[0]![0]).toMatchObject({ bubbles: true, composed: true });

    host.editor!.blur();
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it("maps numeric and enum attributes into the editor config", () => {
    const createSpy = vi.spyOn(coreModule, "createEditor");
    host.setAttribute("initial-value", "config");
    host.setAttribute("tab-size", "2");
    host.setAttribute("direction", "rtl");
    host.setAttribute("indent-guides", "");
    host.setAttribute("slash-menu-limit", "3");
    host.setAttribute("parse-delay-ms", "40");
    document.body.appendChild(host);

    expect(createSpy).toHaveBeenCalledOnce();
    expect(createSpy.mock.calls[0]![0]).toMatchObject({
      initialValue: "config",
      tabSize: 2,
      direction: "rtl",
      indentGuides: true,
      slashMenuLimit: 3,
      parseDelayMs: 40,
    });
  });

  it("passes an explicit ltr direction through instead of dropping it", () => {
    const createSpy = vi.spyOn(coreModule, "createEditor");
    host.setAttribute("direction", "ltr");
    document.body.appendChild(host);

    expect(createSpy.mock.calls[0]![0]).toMatchObject({ direction: "ltr" });
  });

  it("ignores an unparseable numeric attribute instead of passing NaN", () => {
    const createSpy = vi.spyOn(coreModule, "createEditor");
    host.setAttribute("tab-size", "wide");
    document.body.appendChild(host);

    expect(createSpy.mock.calls[0]![0].tabSize).toBeUndefined();
  });

  it("forwards theme, locale, parser and onAssetUpload properties", () => {
    const createSpy = vi.spyOn(coreModule, "createEditor");
    const theme = { name: "test-theme" } as unknown as NexusTheme;
    const locale = { livePreview: { addRow: "Add" } } as unknown as Partial<NexusLocale>;
    const onAssetUpload = vi.fn(async () => null);
    host.theme = theme;
    host.locale = locale;
    host.onAssetUpload = onAssetUpload;
    document.body.appendChild(host);

    expect(createSpy.mock.calls[0]![0]).toMatchObject({ theme, locale, onAssetUpload });
  });

  it("lays out as a block element without consumer CSS", () => {
    document.body.appendChild(host);

    expect(getComputedStyle(host).display).toBe("block");
  });

  it("injects the block rule once into a consumer-owned shadow root", () => {
    const outer = document.createElement("div");
    const shadow = outer.attachShadow({ mode: "open" });
    document.body.append(outer);

    shadow.append(host);
    const second = document.createElement("nexus-editor") as NexusEditorElement;
    shadow.append(second);

    const baseRules = Array.from(shadow.querySelectorAll("style"))
      .filter((style) => (style.textContent ?? "").includes(":where(nexus-editor)"));
    expect(baseRules).toHaveLength(1);
    expect(baseRules[0]!.textContent).toContain("display:block");

    second.remove();
    outer.remove();
  });

  it("rolls back the container when createEditor throws, and recovers on reconnect", () => {
    const createSpy = vi.spyOn(coreModule, "createEditor").mockImplementationOnce(() => {
      throw new Error("boom");
    });
    // A throw inside connectedCallback is reported to the global error handler
    // rather than propagating to appendChild, so swallow it here and assert on
    // the element's own rolled-back state instead.
    const onError = vi.fn((event: Event) => event.preventDefault());
    window.addEventListener("error", onError);

    try {
      document.body.appendChild(host);
    } finally {
      window.removeEventListener("error", onError);
    }

    expect(host.editor).toBeNull();
    expect(host.children).toHaveLength(0);

    // connectedOnce was rolled back, so a later connect can still mount.
    host.remove();
    createSpy.mockRestore();
    document.body.appendChild(host);

    expect(host.editor).not.toBeNull();
  });
});
