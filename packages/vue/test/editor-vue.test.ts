import type { EditorAPI } from "@floatboat/nexus-core";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { Editor, useEditor } from "../src/index";

describe("@floatboat/nexus-vue", () => {
  it("renders an editor into the provided container through the Editor component", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "# Hello"
      }
    });

    await nextTick();

    expect(wrapper.element.querySelector(".cm-editor")).not.toBeNull();
    expect(wrapper.element.querySelector("[contenteditable='true']")).not.toBeNull();

    wrapper.unmount();

    expect(wrapper.element.querySelector(".cm-editor")).toBeNull();
  });

  it("exposes the core editor api through useEditor", async () => {
    const snapshots: string[] = [];

    const Harness = defineComponent({
      setup() {
        const { containerRef, editor } = useEditor({ initialValue: "start" });

        onMounted(() => {
          editor.value?.setDocument("updated");
          if (editor.value) {
            snapshots.push(editor.value.getDocument());
          }
        });

        return () => h("div", { ref: containerRef });
      }
    });

    mount(Harness);

    await nextTick();

    expect(snapshots).toContain("updated");
  });

  it("calls onReady with a usable EditorAPI instance", async () => {
    let ready: EditorAPI | null = null;

    mount(Editor, {
      props: {
        initialValue: "start",
        onReady: (editor: EditorAPI) => {
          ready = editor;
          editor.setDocument("ready");
        }
      }
    });

    await nextTick();

    expect(ready).not.toBeNull();
    expect(ready!.getDocument()).toBe("ready");
  });

  it("passes class to the wrapper div via attrs", async () => {
    const wrapper = mount(Editor, {
      attrs: {
        class: "host"
      }
    });

    await nextTick();

    expect(wrapper.element.classList.contains("host")).toBe(true);
  });

  it("calls onReady from useEditor on first mount", async () => {
    let ready: EditorAPI | null = null;

    const Harness = defineComponent({
      setup() {
        const { containerRef } = useEditor({
          initialValue: "hook",
          onReady: (editor) => {
            ready = editor;
          }
        });

        return () => h("div", { ref: containerRef });
      }
    });

    mount(Harness);

    await nextTick();

    expect(ready).not.toBeNull();
    expect(ready!.getDocument()).toBe("hook");
  });

  it("uses modelValue as the initial document when controlled", async () => {
    const Harness = defineComponent({
      setup() {
        const { containerRef, editor } = useEditor({ modelValue: "controlled-start" });
        return () =>
          h("div", {
            ref: containerRef,
            "data-doc": editor.value?.getDocument() ?? ""
          });
      }
    });

    const wrapper = mount(Harness);
    await nextTick();
    await vi.waitFor(() => {
      expect(wrapper.attributes("data-doc")).toBe("controlled-start");
    });
  });

  it("syncs the editor when modelValue changes", async () => {
    const Harness = defineComponent({
      props: {
        modelValue: {
          type: String,
          required: true
        }
      },
      setup(props) {
        const { containerRef } = useEditor(
          () => ({
            modelValue: props.modelValue,
            onChange: () => {}
          })
        );
        return () => h("div", { ref: containerRef });
      }
    });

    const wrapper = mount(Harness, { props: { modelValue: "first" } });
    await nextTick();
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".cm-line")?.textContent).toBe("first");
    });

    await wrapper.setProps({ modelValue: "second" });
    await nextTick();

    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".cm-line")?.textContent).toBe("second");
    });
  });

  it("forwards document changes through onChange in controlled mode", async () => {
    const onChange = vi.fn();

    const Harness = defineComponent({
      setup() {
        const { containerRef, editor } = useEditor({
          modelValue: "start",
          onChange
        });

        onMounted(() => {
          editor.value?.setDocument("edited");
        });

        return () => h("div", { ref: containerRef });
      }
    });

    mount(Harness);
    await nextTick();

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      expect(onChange.mock.calls.at(-1)?.[0]).toBe("edited");
    });
  });

  it("supports v-model on the Editor component", async () => {
    const doc = ref("alpha");
    const Parent = defineComponent({
      setup() {
        return () =>
          h(Editor, {
            modelValue: doc.value,
            "onUpdate:modelValue": (next: string) => {
              doc.value = next;
            }
          });
      }
    });

    const wrapper = mount(Parent);
    await nextTick();
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".cm-line")?.textContent).toBe("alpha");
    });

    doc.value = "beta";
    await nextTick();

    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".cm-line")?.textContent).toBe("beta");
    });
  });

  it("applies rapid modelValue updates", async () => {
    const Harness = defineComponent({
      props: { modelValue: { type: String, required: true } },
      setup(props) {
        const { containerRef } = useEditor(() => ({
          modelValue: props.modelValue,
          onChange: () => {}
        }));
        return () => h("div", { ref: containerRef });
      }
    });

    const wrapper = mount(Harness, { props: { modelValue: "v1" } });
    await nextTick();
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".cm-line")?.textContent).toBe("v1");
    });

    await wrapper.setProps({ modelValue: "v2" });
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".cm-line")?.textContent).toBe("v2");
    });
  });

  it("supports readOnly with v-model", async () => {
    const wrapper = mount(Editor, {
      props: {
        modelValue: "# Locked",
        readOnly: true
      }
    });

    await nextTick();
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".cm-line")?.textContent).toBe("# Locked");
      expect(wrapper.element.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe(
        "false"
      );
    });
  });

  it("forwards multiCursor to createEditor, enabling multi-selection", async () => {
    let ready: EditorAPI | null = null;

    const wrapper = mount(Editor, {
      props: {
        initialValue: "hello world",
        multiCursor: true,
        onReady: (editor: EditorAPI) => {
          ready = editor;
        }
      }
    });

    await nextTick();
    await vi.waitFor(() => {
      expect(ready).not.toBeNull();
    });

    ready!.setSelections([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);

    const { ranges } = ready!.getSelections();
    expect(ranges).toHaveLength(2);
    expect(ranges).toEqual([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);

    // multiCursor must NOT leak into the DOM — it is a declared prop
    // (inheritAttrs: false, so non-prop attrs go to the container div).
    expect(wrapper.element.hasAttribute("multiCursor")).toBe(false);

    ready!.destroy();
  });

  it("uses single-selection by default when multiCursor is omitted", async () => {
    let ready: EditorAPI | null = null;

    mount(Editor, {
      props: {
        initialValue: "hello world",
        onReady: (editor: EditorAPI) => {
          ready = editor;
        }
      }
    });

    await nextTick();
    await vi.waitFor(() => {
      expect(ready).not.toBeNull();
    });

    ready!.setSelections([
      { anchor: 0, head: 5 },
      { anchor: 6, head: 11 },
    ]);

    const { ranges } = ready!.getSelections();
    expect(ranges).toHaveLength(1);

    ready!.destroy();
  });

  it("keeps initialValue behavior in uncontrolled mode", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "uncontrolled"
      }
    });

    await nextTick();
    await vi.waitFor(() => {
      expect(wrapper.element.querySelector(".cm-line")?.textContent).toBe("uncontrolled");
    });
  });
});
