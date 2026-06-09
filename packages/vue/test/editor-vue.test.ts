import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted } from "vue";
import { describe, expect, it } from "vitest";
import type { EditorAPI } from "@floatboat/nexus-core";
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

  it("passes container attrs through and calls onReady with the core editor", async () => {
    const readyEditors: EditorAPI[] = [];
    const wrapper = mount(Editor, {
      props: {
        initialValue: "# Ready",
        onReady(editor: EditorAPI) {
          readyEditors.push(editor);
        }
      },
      attrs: {
        id: "nexus-vue-editor",
        class: "editor-shell",
        "data-testid": "editor-host",
        "aria-label": "Markdown editor"
      }
    });

    await nextTick();

    expect(wrapper.element.id).toBe("nexus-vue-editor");
    expect(wrapper.classes()).toContain("editor-shell");
    expect(wrapper.attributes("data-testid")).toBe("editor-host");
    expect(wrapper.attributes("aria-label")).toBe("Markdown editor");
    expect(wrapper.element.querySelector(".cm-editor")).not.toBeNull();
    expect(readyEditors).toHaveLength(1);
    expect(readyEditors[0]?.getDocument()).toBe("# Ready");

    wrapper.unmount();
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

  it("calls onReady from useEditor when the editor is mounted", async () => {
    const readyDocs: string[] = [];

    const Harness = defineComponent({
      setup() {
        const { containerRef } = useEditor({
          initialValue: "hook-ready",
          onReady(editor) {
            readyDocs.push(editor.getDocument());
          }
        });

        return () => h("div", { ref: containerRef });
      }
    });

    mount(Harness);

    await nextTick();

    expect(readyDocs).toEqual(["hook-ready"]);
  });
});
