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

  it("forwards class, style, and data-* attributes to the container div", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "hi",
        class: "my-editor",
        style: { border: "1px solid red" },
        "data-testid": "nexus",
        "aria-label": "Markdown editor"
      }
    });

    await nextTick();

    const el = wrapper.element as HTMLElement;
    expect(el.className).toBe("my-editor");
    expect(el.style.border).toBe("1px solid red");
    expect(el.dataset.testid).toBe("nexus");
    expect(el.getAttribute("aria-label")).toBe("Markdown editor");
  });

  it("fires onReady once with the editor instance", async () => {
    const handleReady = vi.fn<(editor: EditorAPI) => void>();

    mount(Editor, {
      props: {
        initialValue: "hi",
        onReady: handleReady
      }
    });

    await nextTick();

    expect(handleReady).toHaveBeenCalledTimes(1);
    expect(handleReady.mock.calls[0][0].getDocument()).toBe("hi");
  });
});
