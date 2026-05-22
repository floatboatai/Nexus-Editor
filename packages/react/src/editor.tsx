import { useEditor } from "./use-editor";

import type { EditorProps } from "./types";

export function Editor({
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
  ...divProps
}: EditorProps) {
  const { containerRef } = useEditor({
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
  });

  return <div ref={containerRef} {...divProps} />;
}
