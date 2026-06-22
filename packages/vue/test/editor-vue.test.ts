import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, onMounted } from "vue";
import { describe, expect, it, vi } from "vitest";
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

  it("fires onReady once with the live editor api", async () => {
    const onReady = vi.fn<(editor: EditorAPI) => void>();

    const wrapper = mount(Editor, {
      props: {
        initialValue: "# Hi",
        onReady
      }
    });

    await nextTick();

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady.mock.calls[0][0].getDocument()).toBe("# Hi");

    wrapper.unmount();
  });

  it("forwards containerProps onto the root element", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "x",
        containerProps: { class: "host-shell", id: "nexus-root", "data-testid": "shell" }
      }
    });

    await nextTick();

    const root = wrapper.element as HTMLElement;

    expect(root.classList.contains("host-shell")).toBe(true);
    expect(root.id).toBe("nexus-root");
    expect(root.getAttribute("data-testid")).toBe("shell");
    expect(root.querySelector(".cm-editor")).not.toBeNull();

    wrapper.unmount();
  });
});
