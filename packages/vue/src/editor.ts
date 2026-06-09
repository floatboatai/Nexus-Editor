import { defineComponent, h } from "vue";
import type { PropType } from "vue";

import { useEditor } from "./use-editor";
import type { UseEditorConfig } from "./types";

const editorProps = {
  initialValue: String,
  parser: Object as PropType<UseEditorConfig["parser"]>,
  parseDelayMs: Number,
  livePreview: [Boolean, Object] as PropType<UseEditorConfig["livePreview"]>,
  plugins: Array as PropType<UseEditorConfig["plugins"]>,
  theme: Object as PropType<UseEditorConfig["theme"]>,
  locale: Object as PropType<UseEditorConfig["locale"]>,
  tabSize: Number,
  direction: String as PropType<UseEditorConfig["direction"]>,
  indentGuides: Boolean,
  readOnly: Boolean,
  slashMenuLimit: Number,
  onChange: Function as PropType<UseEditorConfig["onChange"]>,
  onFocus: Function as PropType<UseEditorConfig["onFocus"]>,
  onBlur: Function as PropType<UseEditorConfig["onBlur"]>,
  onAssetUpload: Function as PropType<UseEditorConfig["onAssetUpload"]>,
  onReady: Function as PropType<UseEditorConfig["onReady"]>
};

export const Editor = defineComponent({
  name: "NexusEditor",
  inheritAttrs: false,
  props: editorProps,
  setup(props, { attrs }) {
    const { containerRef } = useEditor(props);

    return () => h("div", { ...attrs, ref: containerRef });
  }
});
