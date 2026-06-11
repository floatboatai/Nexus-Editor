import { defineComponent, h, useAttrs } from "vue";

import { useEditor } from "./use-editor";
import type { EditorComponentProps } from "./types";

export const Editor = defineComponent({
  name: "NexusEditor",
  inheritAttrs: false,
  props: {
    initialValue: {
      type: String,
      required: false
    },
    class: {
      type: [String, Array, Object] as unknown as () => EditorComponentProps["class"],
      required: false
    },
    style: {
      type: [String, Object, Array] as unknown as () => EditorComponentProps["style"],
      required: false
    }
  },
  setup(props) {
    const attrs = useAttrs();
    const { containerRef } = useEditor({ ...attrs, ...props } as EditorComponentProps);

    return () => h("div", {
      ref: containerRef,
      class: props.class,
      style: props.style
    });
  }
});
