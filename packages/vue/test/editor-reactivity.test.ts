import { darkTheme, lightTheme } from "@floatboat/nexus-core";
import { mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, ref } from "vue";
import { describe, expect, it } from "vitest";
import { Editor } from "../src/index";

describe("Vue Editor Reactivity", () => {
  it("reactively updates readOnly when prop changes on Editor component", async () => {
    const isReadOnly = ref(false);

    const Parent = defineComponent({
      setup() {
        return () =>
          h(Editor, {
            initialValue: "Initial content",
            readOnly: isReadOnly.value,
          });
      },
    });

    const wrapper = mount(Parent);
    await nextTick();

    const content = wrapper.element.querySelector(".cm-content") as HTMLElement;
    expect(content.getAttribute("contenteditable")).toBe("true");

    // Dynamically toggle readOnly
    isReadOnly.value = true;
    await nextTick();

    expect(content.getAttribute("contenteditable")).toBe("false");

    // Toggle back
    isReadOnly.value = false;
    await nextTick();

    expect(content.getAttribute("contenteditable")).toBe("true");
  });

  it("reactively updates direction when prop changes", async () => {
    const dir = ref<"ltr" | "rtl">("ltr");

    const Parent = defineComponent({
      setup() {
        return () =>
          h(Editor, {
            initialValue: "Direction test",
            direction: dir.value,
          });
      },
    });

    const wrapper = mount(Parent);
    await nextTick();

    const content = wrapper.element.querySelector(".cm-content") as HTMLElement;
    expect(content.getAttribute("dir")).toBeNull();

    dir.value = "rtl";
    await nextTick();

    expect(content.getAttribute("dir")).toBe("rtl");

    dir.value = "ltr";
    await nextTick();

    expect(content.getAttribute("dir")).toBeNull();
  });

  it("reactively updates theme when prop changes", async () => {
    const currentTheme = ref(lightTheme);

    const Parent = defineComponent({
      setup() {
        return () =>
          h(Editor, {
            initialValue: "Theme test",
            theme: currentTheme.value,
          });
      },
    });

    const wrapper = mount(Parent);
    await nextTick();

    const cmEditor = wrapper.element.querySelector(".cm-editor") as HTMLElement;
    expect(cmEditor).not.toBeNull();

    currentTheme.value = darkTheme;
    await nextTick();

    expect(wrapper.text()).toContain("Theme test");
  });
});
