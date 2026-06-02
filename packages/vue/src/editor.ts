import { defineComponent, h } from "vue";

import { useEditor } from "./use-editor";

export const Editor = defineComponent({
  name: "NexusEditor",
  props: {
    initialValue: {
      type: String,
      required: false,
    },
  },
  setup(props) {
    const { containerRef } = useEditor(props);

    return () => h("div", { ref: containerRef });
  },
});
