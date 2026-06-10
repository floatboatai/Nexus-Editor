import type {
  EditorAPI,
  EditorConfig,
  LivePreviewConfig,
  NexusLocale,
  NexusPlugin,
  NexusTheme,
  ParserLike
} from "@floatboat/nexus-core";
import type { PropType } from "vue";
import { defineComponent, h } from "vue";

import { pickEditorConfig } from "./editor-config";
import { useEditor } from "./use-editor";

export const Editor = defineComponent({
  name: "NexusEditor",
  inheritAttrs: false,
  props: {
    initialValue: {
      type: String,
      required: false
    },
    parser: {
      type: Object as PropType<ParserLike>,
      required: false
    },
    parseDelayMs: {
      type: Number,
      required: false
    },
    livePreview: {
      type: [Boolean, Object] as PropType<boolean | LivePreviewConfig>,
      required: false
    },
    plugins: {
      type: Array as PropType<NexusPlugin[]>,
      required: false
    },
    theme: {
      type: Object as PropType<NexusTheme>,
      required: false
    },
    locale: {
      type: Object as PropType<Partial<NexusLocale>>,
      required: false
    },
    tabSize: {
      type: Number,
      required: false
    },
    direction: {
      type: String as PropType<"ltr" | "rtl">,
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
    slashMenuLimit: {
      type: Number,
      required: false
    },
    onChange: {
      type: Function as PropType<NonNullable<EditorConfig["onChange"]>>,
      required: false
    },
    onFocus: {
      type: Function as PropType<() => void>,
      required: false
    },
    onBlur: {
      type: Function as PropType<() => void>,
      required: false
    },
    onAssetUpload: {
      type: Function as PropType<(file: File) => Promise<string | null>>,
      required: false
    },
    onReady: {
      type: Function as PropType<(editor: EditorAPI) => void>,
      required: false
    }
  },
  setup(props, { attrs }) {
    const { containerRef } = useEditor(pickEditorConfig(props));

    return () => h("div", { ref: containerRef, ...attrs });
  }
});
