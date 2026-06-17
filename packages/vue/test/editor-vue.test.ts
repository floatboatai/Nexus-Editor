import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted } from "vue";
import { describe, expect, it, vi } from "vitest";
import { Editor, useEditor } from "../src/index";
import type { EditorAPI } from "@floatboat/nexus-core";

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

  it("calls onReady with the editor instance after creation", async () => {
    const onReady = vi.fn();

    mount(Editor, {
      props: {
        initialValue: "# Ready",
        onReady
      } as any
    });

    await nextTick();

    expect(onReady).toHaveBeenCalledTimes(1);
    const editor: EditorAPI = onReady.mock.calls[0][0];
    expect(editor.getDocument()).toBe("# Ready");
  });

  it("passes class, style, and id to the container div", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "",
        class: "my-editor",
        style: "border: 1px solid red",
        id: "editor-1"
      } as any
    });

    await nextTick();

    expect(wrapper.element.className).toContain("my-editor");
    expect((wrapper.element as HTMLElement).style.border).toBe("1px solid red");
    expect(wrapper.element.id).toBe("editor-1");
  });
});
