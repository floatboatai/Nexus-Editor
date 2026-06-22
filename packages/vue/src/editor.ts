import { defineComponent, h } from "vue";
import type { PropType } from "vue";

import type { EditorAPI } from "@floatboat/nexus-core";

import { useEditor } from "./use-editor";
import type { EditorContainerProps } from "./types";

export const Editor = defineComponent({
  name: "NexusEditor",
  props: {
    initialValue: {
      type: String,
      required: false
    },
    onReady: {
      type: Function as PropType<(editor: EditorAPI) => void>,
      required: false
    },
    containerProps: {
      type: Object as PropType<EditorContainerProps>,
      required: false
    }
  },
  setup(props) {
    const { containerRef } = useEditor({
      initialValue: props.initialValue,
      onReady: props.onReady
    });

    return () => h("div", { ref: containerRef, ...props.containerProps });
  }
});
