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

  it("passes container attrs through to the wrapper element", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "# Hello"
      },
      attrs: {
        class: "my-editor",
        "data-testid": "note-editor",
        style: { minHeight: "320px" }
      }
    });

    await nextTick();

    expect(wrapper.element.classList.contains("my-editor")).toBe(true);
    expect(wrapper.element.getAttribute("data-testid")).toBe("note-editor");
    expect(wrapper.element.style.minHeight).toBe("320px");
    expect(wrapper.element.querySelector(".cm-editor")).not.toBeNull();

    wrapper.unmount();
  });

  it("calls onReady once with the editor api", async () => {
    const readyDocuments: string[] = [];

    mount(Editor, {
      props: {
        initialValue: "ready-check",
        onReady: (editor) => {
          readyDocuments.push(editor.getDocument());
        }
      }
    });

    await nextTick();

    expect(readyDocuments).toEqual(["ready-check"]);
  });

  it("calls onReady from useEditor without going through Editor", async () => {
    const readyDocuments: string[] = [];

    const Harness = defineComponent({
      setup() {
        const { containerRef } = useEditor({
          initialValue: "hook-ready",
          onReady: (editor) => {
            readyDocuments.push(editor.getDocument());
          }
        });

        return () => h("div", { ref: containerRef });
      }
    });

    mount(Harness);

    await nextTick();

    expect(readyDocuments).toEqual(["hook-ready"]);
  });

  it("forwards readOnly to the underlying editor", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "# Hello",
        readOnly: true
      }
    });

    await nextTick();

    const content = wrapper.element.querySelector(".cm-content");
    expect(content?.getAttribute("contenteditable")).toBe("false");

    wrapper.unmount();
  });

  it("keeps declared editor props off the wrapper element attrs", async () => {
    const wrapper = mount(Editor, {
      props: {
        initialValue: "# Hello",
        readOnly: true,
        onReady: () => {}
      },
      attrs: {
        class: "my-editor",
        "data-testid": "note-editor"
      }
    });

    await nextTick();

    expect(wrapper.element.classList.contains("my-editor")).toBe(true);
    expect(wrapper.element.getAttribute("data-testid")).toBe("note-editor");
    expect(wrapper.element.getAttribute("initialvalue")).toBeNull();
    expect(wrapper.element.getAttribute("readonly")).toBeNull();

    wrapper.unmount();
  });
});
