import { defineComponent, h } from "vue";

import { useEditor } from "./use-editor";
import type { UseEditorConfig } from "./types";

export const Editor = defineComponent({
  name: "NexusEditor",
  props: {
    initialValue: {
      type: String,
      required: false
    },
    onReady: {
      type: Function as unknown as () => UseEditorConfig["onReady"],
      required: false
    }
  },
  setup(props, { attrs }) {
    const { containerRef } = useEditor({ ...props, ...attrs });

    return () => h("div", { ref: containerRef, ...attrs });
  }
});
