import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted } from "vue";
import { describe, expect, it } from "vitest";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
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

  it("exposes reactive canUndo and canRedo from useEditor", async () => {
    const states: Array<{ canUndo: boolean; canRedo: boolean }> = [];

    const Harness = defineComponent({
      setup() {
        const { containerRef, editor, canUndo, canRedo } = useEditor({
          initialValue: "start",
          plugins: [createHistoryPlugin()],
        });

        onMounted(() => {
          // 初始状态
          states.push({
            canUndo: canUndo.value,
            canRedo: canRedo.value,
          });

          editor.value?.setDocument("updated");
        });

        // 用 watchEffect 方式追踪
        const pushState = () => {
          if (editor.value) {
            states.push({
              canUndo: canUndo.value,
              canRedo: canRedo.value,
            });
          }
        };

        return () => {
          pushState();
          return h("div", { ref: containerRef });
        };
      },
    });

    mount(Harness);

    await nextTick();
    await nextTick();

    // 初始状态：无可撤销
    expect(states[0]).toEqual({ canUndo: false, canRedo: false });
    // 渲染后（setDocument 已调用）：canUndo 应变为 true
    expect(states[states.length - 1]).toEqual({ canUndo: true, canRedo: false });
  });
});
