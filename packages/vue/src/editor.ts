import { computed, defineComponent, h, type PropType } from "vue";

import { useEditor } from "./use-editor";

import type { EditorAPI } from "@floatboat/nexus-core";
import type { EditorProps, UseEditorConfig } from "./types";

const editorPropKeys = [
  "initialValue",
  "parser",
  "parseDelayMs",
  "livePreview",
  "plugins",
  "theme",
  "locale",
  "tabSize",
  "direction",
  "indentGuides",
  "readOnly",
  "multiCursor",
  "slashMenuLimit",
  "onChange",
  "onFocus",
  "onBlur",
  "onAssetUpload",
  "onReady"
] as const;

function pickEditorConfig(props: EditorProps): UseEditorConfig {
  const config = {} as UseEditorConfig;

  for (const key of editorPropKeys) {
    const value = props[key];

    if (value !== undefined) {
      (config as Record<string, unknown>)[key] = value;
    }
  }

  return config;
}

export const Editor = defineComponent({
  name: "NexusEditor",
  inheritAttrs: false,
  props: {
    modelValue: {
      type: String,
      required: false
    },
    initialValue: {
      type: String,
      required: false
    },
    parser: {
      type: Object as PropType<EditorProps["parser"]>,
      required: false
    },
    parseDelayMs: {
      type: Number,
      required: false
    },
    livePreview: {
      type: [Boolean, Object] as PropType<EditorProps["livePreview"]>,
      required: false
    },
    plugins: {
      type: Array as PropType<EditorProps["plugins"]>,
      required: false
    },
    theme: {
      type: Object as PropType<EditorProps["theme"]>,
      required: false
    },
    locale: {
      type: Object as PropType<EditorProps["locale"]>,
      required: false
    },
    tabSize: {
      type: Number,
      required: false
    },
    direction: {
      type: String as PropType<EditorProps["direction"]>,
      required: false
    },
    indentGuides: {
      type: Boolean,
      required: false
    },
    readOnly: {
      type: Boolean,
      required: false
    },
    multiCursor: {
      type: Boolean,
      required: false
    },
    slashMenuLimit: {
      type: Number,
      required: false
    },
    onChange: {
      type: Function as PropType<EditorProps["onChange"]>,
      required: false
    },
    onFocus: {
      type: Function as PropType<EditorProps["onFocus"]>,
      required: false
    },
    onBlur: {
      type: Function as PropType<EditorProps["onBlur"]>,
      required: false
    },
    onAssetUpload: {
      type: Function as PropType<EditorProps["onAssetUpload"]>,
      required: false
    },
    onReady: {
      type: Function as PropType<(editor: EditorAPI) => void>,
      required: false
    }
  },
  emits: {
    "update:modelValue": (_value: string) => true
  },
  setup(props, { emit, attrs }) {
    const editorConfig = computed<UseEditorConfig>(() => {
      const config = pickEditorConfig(props as EditorProps);
      const { modelValue } = props;
      const userOnChange = config.onChange;

      return {
        ...config,
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

    return () => h("div", { ref: containerRef, ...attrs });
  }
});
