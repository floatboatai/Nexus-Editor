import { defineComponent, h } from "vue";

import { useEditor } from "./use-editor";

export const Editor = defineComponent({
  name: "NexusEditor",
  props: {
    initialValue: {
      type: String,
      required: false
    },
    class: {
      type: String,
      required: false
    },
    style: {
      type: [String, Object],
      required: false
    },
    id: {
      type: String,
      required: false
    }
  },
  setup(props, { attrs }) {
    const { class: className, style, id, ...editorProps } = props;
    const { containerRef } = useEditor({ ...editorProps, ...attrs } as any);

    return () => h("div", { ref: containerRef, class: className, style, id });
  }
});
