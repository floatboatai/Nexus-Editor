import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted } from "vue";
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

  it("calls onReady callback when editor is initialized", async () => {
    const onReady = vi.fn();

    const Harness = defineComponent({
      setup() {
        const { containerRef } = useEditor({
          initialValue: "hello",
          onReady
        });

        return () => h("div", { ref: containerRef });
      }
    });

    mount(Harness);

    await nextTick();

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(expect.objectContaining({
      getDocument: expect.any(Function),
      setDocument: expect.any(Function),
      getSelection: expect.any(Function),
      getSelectedText: expect.any(Function),
    }));
  });

  it("onReady callback receives working editor instance", async () => {
    let readyDoc = "";

    const Harness = defineComponent({
      setup() {
        const { containerRef } = useEditor({
          initialValue: "initial content",
          onReady: (editor) => {
            readyDoc = editor.getDocument();
            editor.setDocument("modified by onReady");
          }
        });

        return () => h("div", { ref: containerRef });
      }
    });

    mount(Harness);

    await nextTick();

    expect(readyDoc).toBe("initial content");
  });
});
