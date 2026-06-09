import { useEditor } from "./use-editor";

import type { EditorProps, UseEditorConfig } from "./types";

export function Editor(props: EditorProps) {
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
    ...containerProps
  } = props;
  const editorConfig: UseEditorConfig = {
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
    onReady
  };
  const { containerRef } = useEditor(editorConfig);

  return <div {...containerProps} ref={containerRef} />;
}
