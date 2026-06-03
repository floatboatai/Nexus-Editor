import type {
  LivePreviewConfig,
  NexusPlugin,
  ParserLike,
} from "@floatboat/nexus-core";
import type { NexusLocale } from "@floatboat/nexus-core";
import type { NexusTheme } from "@floatboat/nexus-core";
import type { PropType } from "vue";
import { defineComponent, h, watch } from "vue";

import { useEditor } from "./use-editor";

export const Editor = defineComponent({
  name: "NexusEditor",
  props: {
    initialValue: {
      type: String,
      required: false,
    },
    parser: {
      type: Object as PropType<ParserLike>,
      required: false,
    },
    parseDelayMs: {
      type: Number,
      required: false,
    },
    livePreview: {
      type: [Boolean, Object] as PropType<boolean | LivePreviewConfig>,
      required: false,
    },
    plugins: {
      type: Array as PropType<NexusPlugin[]>,
      required: false,
    },
    theme: {
      type: Object as PropType<NexusTheme>,
      required: false,
    },
    locale: {
      type: Object as PropType<Partial<NexusLocale>>,
      required: false,
    },
    tabSize: {
      type: Number,
      required: false,
    },
    direction: {
      type: String as PropType<"ltr" | "rtl">,
      required: false,
    },
    indentGuides: {
      type: Boolean,
      required: false,
    },
    readOnly: {
      type: Boolean,
      required: false,
    },
    slashMenuLimit: {
      type: Number,
      required: false,
    },
    onChange: {
      type: Function as PropType<(doc: string, ast: unknown) => void>,
      required: false,
    },
    onFocus: {
      type: Function as PropType<() => void>,
      required: false,
    },
    onBlur: {
      type: Function as PropType<() => void>,
      required: false,
    },
    onAssetUpload: {
      type: Function as PropType<(file: File) => Promise<string | null>>,
      required: false,
    },
    onReady: {
      type: Function as PropType<(editor: ReturnType<typeof import("@floatboat/nexus-core").createEditor>) => void>,
      required: false,
    },
  },
  setup(props) {
    const {
      initialValue,
      parser,
      parseDelayMs,
      livePreview,
      plugins,
      theme,
      locale,
      tabSize,
      direction,
      indentGuides,
      readOnly,
      slashMenuLimit,
      onChange,
      onFocus,
      onBlur,
      onAssetUpload,
      onReady,
    } = props;

    const { containerRef, editor } = useEditor({
      initialValue,
      parser,
      parseDelayMs,
      livePreview,
      plugins,
      theme,
      locale,
      tabSize,
      direction,
      indentGuides,
      readOnly,
      slashMenuLimit,
      onChange,
      onFocus,
      onBlur,
      onAssetUpload,
    });

    watch(
      editor,
      (ed) => {
        if (ed && onReady) {
          onReady(ed);
        }
      },
      { immediate: true }
    );

    return () => h("div", { ref: containerRef });
  },
});
