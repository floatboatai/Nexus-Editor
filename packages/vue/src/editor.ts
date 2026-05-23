import { computed, defineComponent, h } from "vue";

import { useEditor } from "./use-editor";

import type { UseEditorConfig } from "./types";

export const Editor = defineComponent({
  name: "NexusEditor",
  props: {
    modelValue: {
      type: String,
      required: false
    },
    initialValue: {
      type: String,
      required: false
    }
  },
  emits: {
    "update:modelValue": (_value: string) => true
  },
  setup(props, { emit, attrs }) {
    const editorConfig = computed<UseEditorConfig>(() => {
      const { modelValue, initialValue } = props;
      const { onChange: userOnChange, ...passthrough } = attrs as UseEditorConfig;

      return {
        ...passthrough,
        initialValue,
        modelValue,
        onChange: (doc, ast) => {
          if (modelValue !== undefined) {
            emit("update:modelValue", doc);
          }
          userOnChange?.(doc, ast);
        }
      };
    });

    const { containerRef } = useEditor(editorConfig);

    return () => h("div", { ref: containerRef });
  }
});
