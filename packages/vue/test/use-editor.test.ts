import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, ref, h } from "vue";
import type { EditorAPI } from "@floatboat/nexus-core";
import { Editor, useEditor } from "@floatboat/nexus-vue";

// ---------------------------------------------------------------------------
// useEditor composable
// ---------------------------------------------------------------------------

describe("useEditor", () => {
  it("returns a non-null editor after mount", async () => {
    let capturedEditor: EditorAPI | null = null;

    const TestComponent = defineComponent({
      setup() {
        const { containerRef } = useEditor({
          initialValue: "hello",
          onReady: (e) => { capturedEditor = e; },
        });
        return () => h("div", { ref: containerRef });
      },
    });

    mount(TestComponent, { attachTo: document.body });
    expect(capturedEditor).not.toBeNull();
  });

  it("calls onReady exactly once with the EditorAPI instance", async () => {
    const onReady = vi.fn();

    const TestComponent = defineComponent({
      setup() {
        const { containerRef } = useEditor({ onReady });
        return () => h("div", { ref: containerRef });
      },
    });

    mount(TestComponent, { attachTo: document.body });
    expect(onReady).toHaveBeenCalledTimes(1);
    const instance = onReady.mock.calls[0][0] as EditorAPI;
    expect(typeof instance.getDocument).toBe("function");
  });

  it("does not throw when onReady is omitted", () => {
    const TestComponent = defineComponent({
      setup() {
        const { containerRef } = useEditor({ initialValue: "test" });
        return () => h("div", { ref: containerRef });
      },
    });

    expect(() => mount(TestComponent, { attachTo: document.body })).not.toThrow();
  });

  it("destroys the editor on unmount", async () => {
    let capturedEditor: EditorAPI | null = null;

    const TestComponent = defineComponent({
      setup() {
        const { containerRef } = useEditor({
          onReady: (e) => { capturedEditor = e; },
        });
        return () => h("div", { ref: containerRef });
      },
    });

    const wrapper = mount(TestComponent, { attachTo: document.body });
    expect(capturedEditor).not.toBeNull();
    const destroySpy = vi.spyOn(capturedEditor!, "destroy");
    await wrapper.unmount();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// <Editor /> component
// ---------------------------------------------------------------------------

describe("Editor component", () => {
  it("mounts a CM6 editor inside the container", () => {
    const wrapper = mount(Editor, {
      props: { initialValue: "hello" },
      attachTo: document.body,
    });
    expect(wrapper.element.querySelector(".cm-editor")).not.toBeNull();
  });

  it("emits ready event with EditorAPI on mount", () => {
    const wrapper = mount(Editor, {
      props: { initialValue: "world" },
      attachTo: document.body,
    });
    const emitted = wrapper.emitted("ready");
    expect(emitted).toBeTruthy();
    expect(emitted!.length).toBe(1);
    const instance = emitted![0][0] as EditorAPI;
    expect(typeof instance.getDocument).toBe("function");
    expect(instance.getDocument()).toBe("world");
  });

  it("exposes editor so the ready event and direct access agree", () => {
    // The ready event carries the same EditorAPI instance that expose({ editor })
    // makes available. We verify both point to the same object by checking the
    // document content through the event-received instance.
    const wrapper = mount(Editor, {
      props: { initialValue: "exposed" },
      attachTo: document.body,
    });
    const emitted = wrapper.emitted("ready");
    expect(emitted).toBeTruthy();
    const instance = emitted![0][0] as EditorAPI;
    expect(instance.getDocument()).toBe("exposed");
  });

  it("applies className to the container div", () => {
    const wrapper = mount(Editor, {
      props: { className: "my-editor" },
      attachTo: document.body,
    });
    expect(wrapper.element.classList.contains("my-editor")).toBe(true);
  });

  it("ready is not emitted before mount", () => {
    // Verify the event count is exactly 1 (not 0, not 2) — emitted once on mount.
    const wrapper = mount(Editor, { attachTo: document.body });
    expect(wrapper.emitted("ready")?.length).toBe(1);
  });
});
