import { useEditor } from "./use-editor";

import type { ContainerProps, UseEditorConfig } from "./types";

export type EditorProps = UseEditorConfig & ContainerProps;

export function Editor({ className, id, style, ...editorConfig }: EditorProps) {
  const { containerRef } = useEditor(editorConfig);

  return <div ref={containerRef} className={className} id={id} style={style} />;
}
