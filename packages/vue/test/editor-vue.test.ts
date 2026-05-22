import type { EditorAPI } from "@floatboat/nexus-core";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted } from "vue";
import { describe, expect, it } from "vitest";
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
});
