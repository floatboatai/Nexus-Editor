import type { EditorAPI, NexusPlugin } from "@floatboat/nexus-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineNexusEditor,
  NexusEditorElement,
  type NexusChangeDetail,
  type NexusReadyDetail
} from "../src/index";

/** Flush the microtask queue plus one macrotask (deferred destroy / coalesced rebuild). */
function flushLifecycle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createElement(attrs: Record<string, string> = {}): NexusEditorElement {
  const el = document.createElement("nexus-editor") as NexusEditorElement;
  for (const [name, value] of Object.entries(attrs)) {
    el.setAttribute(name, value);
  }
  return el;
}

afterEach(async () => {
  document.body.innerHTML = "";
  await flushLifecycle();
});

describe("registration", () => {
  it("does not register anything as an import side effect", () => {
    expect(customElements.get("nexus-editor")).toBeUndefined();
  });

  it("registers the default tag and is idempotent", () => {
    defineNexusEditor();
    defineNexusEditor();

    expect(customElements.get("nexus-editor")).toBe(NexusEditorElement);
  });

  it("throws when the tag is claimed by a different constructor", () => {
    class Impostor extends HTMLElement {}
    customElements.define("nexus-impostor", Impostor);

    expect(() => defineNexusEditor("nexus-impostor")).toThrow(/nexus-impostor/);
  });
});

describe("lifecycle", () => {
  it("mounts an editor and emits nexus-ready on connection", () => {
    defineNexusEditor();
    const el = createElement({ value: "# Hi" });
    const onReady = vi.fn();
    el.addEventListener("nexus-ready", onReady);

    document.body.appendChild(el);

    expect(el.querySelector(".cm-editor")).not.toBeNull();
    expect(onReady).toHaveBeenCalledOnce();
    const detail = (onReady.mock.calls[0][0] as CustomEvent<NexusReadyDetail>).detail;
    expect(detail.editor).toBe(el.editor);
    expect(el.editor?.getDocument()).toBe("# Hi");
  });

  it("destroys the editor when the element leaves the document", async () => {
    defineNexusEditor();
    const el = createElement();
    document.body.appendChild(el);

    el.remove();
    await flushLifecycle();

    expect(el.editor).toBeNull();
    expect(el.querySelector(".cm-editor")).toBeNull();
  });

  it("keeps the same editor instance across same-task reparenting", async () => {
    defineNexusEditor();
    const el = createElement({ value: "moved" });
    document.body.appendChild(el);
    const editor = el.editor;

    const newParent = document.createElement("section");
    document.body.appendChild(newParent);
    newParent.appendChild(el);
    await flushLifecycle();

    expect(el.editor).toBe(editor);
    expect(el.editor?.getDocument()).toBe("moved");
  });

  it("restores the captured document when re-inserted after removal", async () => {
    defineNexusEditor();
    const el = createElement();
    document.body.appendChild(el);
    el.editor?.setDocument("draft");

    el.remove();
    await flushLifecycle();
    expect(el.editor).toBeNull();

    document.body.appendChild(el);

    expect(el.editor).not.toBeNull();
    expect(el.editor?.getDocument()).toBe("draft");
  });
});

describe("config", () => {
  it("applies scalar attributes to the created editor", () => {
    defineNexusEditor();
    const el = createElement({ value: "# Hi", readonly: "", direction: "rtl" });

    document.body.appendChild(el);

    expect(el.editor?.getDocument()).toBe("# Hi");
    expect(el.querySelector("[contenteditable='true']")).toBeNull();
    expect(el.querySelector(".cm-content")?.getAttribute("dir")).toBe("rtl");
  });

  it("applies plugins set as a property before connection", () => {
    defineNexusEditor();
    const plugin: NexusPlugin = {
      name: "probe",
      slashCommands: [{ id: "probe-cmd", title: "Probe" }]
    };
    const el = createElement();
    el.plugins = [plugin];

    document.body.appendChild(el);

    const ids = el.editor?.getSlashCommands().map((command) => command.id);
    expect(ids).toContain("probe-cmd");
  });

  it("lets an explicit property override the attribute", () => {
    defineNexusEditor();
    const withPreview = createElement({ value: "Intro\n\n> Quote", "live-preview": "" });
    document.body.appendChild(withPreview);
    expect(withPreview.textContent).not.toContain("> Quote");

    const overridden = createElement({ value: "Intro\n\n> Quote", "live-preview": "" });
    overridden.livePreview = false;
    document.body.appendChild(overridden);

    expect(overridden.querySelector(".cm-editor")).not.toBeNull();
    expect(overridden.textContent).toContain("> Quote");
  });
});

describe("controlled document", () => {
  it("applies external value updates silently", () => {
    defineNexusEditor();
    const el = createElement({ value: "before" });
    document.body.appendChild(el);
    const onChange = vi.fn();
    el.addEventListener("nexus-change", onChange);

    el.value = "after";

    expect(el.editor?.getDocument()).toBe("after");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("syncs value attribute updates on a mounted element", () => {
    defineNexusEditor();
    const el = createElement({ value: "before" });
    document.body.appendChild(el);
    const onChange = vi.fn();
    el.addEventListener("nexus-change", onChange);

    el.setAttribute("value", "after");

    expect(el.editor?.getDocument()).toBe("after");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the document when the value attribute is removed", () => {
    defineNexusEditor();
    const el = createElement({ value: "keep me" });
    document.body.appendChild(el);

    el.removeAttribute("value");

    expect(el.editor?.getDocument()).toBe("keep me");
  });

  it("lets a value attribute set while destroyed win over the captured document", async () => {
    defineNexusEditor();
    const el = createElement({ value: "one" });
    document.body.appendChild(el);
    el.editor?.setDocument("draft");

    el.remove();
    await flushLifecycle();
    el.setAttribute("value", "server");
    document.body.appendChild(el);

    expect(el.editor?.getDocument()).toBe("server");
  });

  it("does not poison the sync guard when a value push is deferred by IME composition", () => {
    defineNexusEditor();
    const el = createElement({ value: "old" });
    document.body.appendChild(el);
    const content = el.querySelector(".cm-content");
    expect(content).not.toBeNull();

    content!.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    el.value = "server";
    expect(el.editor?.getDocument()).toBe("old");

    content!.dispatchEvent(new Event("compositionend", { bubbles: true }));
    el.value = "server";

    expect(el.editor?.getDocument()).toBe("server");
  });

  it("recovers a controlled push dropped by a rebuild during IME composition", async () => {
    defineNexusEditor();
    const el = createElement({ value: "old" });
    document.body.appendChild(el);
    const content = el.querySelector(".cm-content");

    content!.dispatchEvent(new Event("compositionstart", { bubbles: true }));
    el.value = "server";
    el.setAttribute("readonly", "");
    await flushLifecycle();

    expect(el.editor?.getDocument()).toBe("old");
    el.value = "server";

    expect(el.editor?.getDocument()).toBe("server");
  });

  it("emits nexus-change with markdown and ast for editor-driven edits", () => {
    defineNexusEditor();
    const el = createElement();
    document.body.appendChild(el);
    const onChange = vi.fn();
    el.addEventListener("nexus-change", onChange);

    el.editor?.setDocument("# Edited");

    expect(onChange).toHaveBeenCalledOnce();
    const detail = (onChange.mock.calls[0][0] as CustomEvent<NexusChangeDetail>).detail;
    expect(detail.markdown).toBe("# Edited");
    expect(detail.ast).toHaveProperty("type", "root");
    expect(el.value).toBe("# Edited");
  });
});

describe("post-mount config changes", () => {
  it("rebuilds so readonly takes effect, preserving document and selection", async () => {
    defineNexusEditor();
    const el = createElement({ value: "hello world" });
    document.body.appendChild(el);
    el.editor?.setSelection(4);
    expect(el.querySelector("[contenteditable='true']")).not.toBeNull();

    el.setAttribute("readonly", "");
    await flushLifecycle();

    expect(el.querySelector("[contenteditable='true']")).toBeNull();
    expect(el.editor?.getDocument()).toBe("hello world");
    expect(el.editor?.getSelection()).toEqual({ anchor: 4, head: 4 });
  });

  it("coalesces multiple same-task attribute writes into one rebuild", async () => {
    defineNexusEditor();
    const el = createElement();
    document.body.appendChild(el);
    const onReady = vi.fn();
    el.addEventListener("nexus-ready", onReady);

    el.setAttribute("tab-size", "2");
    el.setAttribute("direction", "rtl");
    el.setAttribute("indent-guides", "");
    await flushLifecycle();

    expect(onReady).toHaveBeenCalledOnce();
    expect(el.querySelector(".cm-content")?.getAttribute("dir")).toBe("rtl");
  });

  it("hands out the fresh EditorAPI through the repeated nexus-ready", async () => {
    defineNexusEditor();
    const el = createElement();
    document.body.appendChild(el);
    const before = el.editor;
    let after: EditorAPI | null = null;
    el.addEventListener("nexus-ready", (event) => {
      after = (event as CustomEvent<NexusReadyDetail>).detail.editor;
    });

    el.setAttribute("readonly", "");
    await flushLifecycle();

    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(after).toBe(el.editor);
  });
});

describe("events", () => {
  it("bubbles composed nexus events to ancestors", () => {
    defineNexusEditor();
    const wrapper = document.createElement("div");
    document.body.appendChild(wrapper);
    const el = createElement();
    wrapper.appendChild(el);
    const onChange = vi.fn();
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    wrapper.addEventListener("nexus-change", onChange);
    wrapper.addEventListener("nexus-focus", onFocus);
    wrapper.addEventListener("nexus-blur", onBlur);

    el.editor?.setDocument("bubbled");
    el.editor?.focus();
    el.editor?.blur();

    expect(onChange).toHaveBeenCalledOnce();
    expect(onFocus).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
    expect((onChange.mock.calls[0][0] as CustomEvent).composed).toBe(true);
  });
});
