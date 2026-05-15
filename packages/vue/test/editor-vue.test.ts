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

  it("fires onReady with the editor instance", async () => {
    const readySpy = vi.fn();
    mount(Editor, {
      props: {
        initialValue: "hello",
        onReady: readySpy
      }
    });

    await nextTick();

    expect(readySpy).toHaveBeenCalledTimes(1);
    const receivedEditor: EditorAPI = readySpy.mock.calls[0][0];
    expect(receivedEditor.getDocument()).toBe("hello");
  });

  it("passes through container attributes", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "test",
        class: "my-editor",
        id: "editor-main"
      }
    });

    await nextTick();

    expect(wrapper.element.className).toBe("my-editor");
    expect(wrapper.element.id).toBe("editor-main");
  });
});
