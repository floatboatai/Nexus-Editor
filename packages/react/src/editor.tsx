import { useEditor } from "./use-editor";

import type { EditorProps } from "./types";

export function Editor({
  value,
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
  htmlPaste,
  onReady,
  runtime,
  ...divProps
}: EditorProps) {
  const { containerRef } = useEditor({
    value,
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
    htmlPaste,
    onReady,
    runtime
  });

  return <div ref={containerRef} {...divProps} />;
}
