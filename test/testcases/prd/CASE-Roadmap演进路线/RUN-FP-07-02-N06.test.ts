import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { Editor } from "@floatboat/nexus-vue";

describe("FP-07-02-N06: Vue <Editor /> 组件挂载与卸载清理", () => {
  it("步骤1-2: 挂载后编辑区存在，卸载后移除", async () => {
    const wrapper = mount(Editor, { props: { initialValue: "# Hello" } });

    // 步骤1: [DOM] await nextTick 后 .cm-editor 与编辑区存在
    await nextTick();
    expect(wrapper.element.querySelector(".cm-editor")).not.toBeNull();
    expect(wrapper.element.querySelector("[contenteditable='true']")).not.toBeNull();
    // 步骤2: [DOM] unmount 后 .cm-editor 移除
    wrapper.unmount();
    expect(wrapper.element.querySelector(".cm-editor")).toBeNull();
  });
});
