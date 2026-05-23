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
