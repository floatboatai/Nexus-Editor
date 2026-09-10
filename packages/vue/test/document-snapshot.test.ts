import type {
  CaptureDocumentSnapshotOptions,
  EditorAPI,
  EditorDocumentSnapshot,
} from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { Editor, useEditor, type UseEditorResult } from "@floatboat/nexus-vue";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

const mounted = new Set<{ unmount(): void }>();
afterEach(() => {
  for (const wrapper of mounted) wrapper.unmount();
  mounted.clear();
  document.body.replaceChildren();
});

describe("Vue document snapshots through the public editor instance", () => {
  it("exposes the same snapshot-capable EditorAPI through the composable and onReady", async () => {
    const ready: EditorAPI[] = [];
    const published: EditorAPI[] = [];
    const Harness = defineComponent({
      setup() {
        const binding: UseEditorResult = useEditor({
          initialValue: "# Composable document",
          onReady: (editor) => ready.push(editor),
        });
        onMounted(() => {
          if (binding.editor.value) published.push(binding.editor.value);
        });
        return () => h("div", { ref: binding.containerRef });
      },
    });
    const wrapper = mount(Harness, { attachTo: document.body });
    mounted.add(wrapper);
    await nextTick();
    const editor = published.at(-1);
    if (!editor) throw new Error("Composable did not expose its editor");
    expect(editor).toBe(ready[0]);

    const options: CaptureDocumentSnapshotOptions = { includeRenderAst: true };
    const snapshot: EditorDocumentSnapshot = await editor.captureDocumentSnapshot(options);

    expect(snapshot.markdown).toBe("# Composable document");
    expect(snapshot.renderAst?.children[0]).toMatchObject({ type: "heading", depth: 1 });
  });

  it("captures pending table input through onReady without emitting a stale v-model update", async () => {
    const modelValue = "| A | B |\n| --- | --- |\n| 1 | old |";
    const onChange = vi.fn();
    const updateModel = vi.fn();
    const ready = vi.fn<(editor: EditorAPI) => void>();
    const wrapper = mount(Editor, {
      attachTo: document.body,
      props: {
        modelValue,
        livePreview: true,
        plugins: [createGfmPreset()],
        onReady: ready,
        onChange,
        "onUpdate:modelValue": updateModel,
      },
    });
    mounted.add(wrapper);
    await nextTick();
    const editor = ready.mock.calls[0]?.[0];
    if (!editor) throw new Error("Component did not expose its editor");
    const root = wrapper.element;
    if (!(root instanceof HTMLElement)) throw new Error("Missing editor container");
    const cells = root.querySelectorAll<HTMLElement>(".nexus-cell");
    const cell = cells[cells.length - 1];
    if (!cell) throw new Error("Missing table cell");
    cell.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    // jsdom needs an explicit tab stop for a contentEditable cell to receive focus.
    cell.tabIndex = -1;
    cell.focus();
    cell.textContent = "pending 中文";
    cell.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    const selection = editor.getSelection();

    const snapshot = await editor.captureDocumentSnapshot();

    expect(snapshot).toEqual({ markdown: "| A | B |\n| --- | --- |\n| 1 | pending 中文 |", revision: editor.getDocumentRevision?.() });
    expect(editor.getDocument()).toBe(modelValue);
    expect(onChange).not.toHaveBeenCalled();
    expect(updateModel).not.toHaveBeenCalled();
    expect(editor.getSelection()).toEqual(selection);
    expect(document.activeElement).toBe(cell);
  });

  it.each(["component", "composable"] as const)("aborts a pending snapshot when the %s unmounts", async (kind) => {
    const ready = vi.fn<(editor: EditorAPI) => void>();
    const Harness = defineComponent({
      setup() {
        const { containerRef } = useEditor({ initialValue: "Waiting", onReady: ready });
        return () => h("div", { ref: containerRef });
      },
    });
    const wrapper = kind === "component"
      ? mount(Editor, { attachTo: document.body, props: { initialValue: "Waiting", onReady: ready } })
      : mount(Harness, { attachTo: document.body });
    mounted.add(wrapper);
    await nextTick();
    const editor = ready.mock.calls[0]?.[0];
    const content = wrapper.element.querySelector(".cm-content");
    if (!editor || !content) throw new Error("Missing mounted editor");
    content.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(editor.isComposing()).toBe(true);
    const settled = vi.fn();
    const pending = editor.captureDocumentSnapshot();
    const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    void pending.then(settled, settled);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).not.toHaveBeenCalled();

    wrapper.unmount();
    mounted.delete(wrapper);

    await rejection;
    expect(settled).toHaveBeenCalledOnce();
    expect(settled.mock.calls[0]?.[0]).toMatchObject({ name: "AbortError" });
    await expect(editor.captureDocumentSnapshot()).rejects.toMatchObject({ name: "AbortError" });
  });
});
