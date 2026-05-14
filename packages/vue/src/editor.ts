import { defineComponent, h } from "vue";

import type { EditorAPI } from "@floatboat/nexus-core";
import { useEditor } from "./use-editor";
import type { UseEditorConfig } from "./types";

export const Editor = defineComponent({
  name: "NexusEditor",
  props: {
    initialValue: {
      type: String,
      required: false
    },
    className: {
      type: String,
      required: false
    }
  },
  emits: {
    ready: (_editor: EditorAPI) => true
  },
  setup(props, { emit, expose, attrs }) {
    const config: UseEditorConfig = {
      ...attrs,
      initialValue: props.initialValue,
      onReady: (editor) => emit("ready", editor)
    };

    const { containerRef, editor } = useEditor(config);

    expose({ editor });

    return () =>
      h("div", {
        ref: containerRef,
        class: props.className
      });
  }
});
