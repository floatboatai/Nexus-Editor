import { useEditor } from "./use-editor";

import type { EditorProps } from "./types";

export function Editor({ className, style, id, ...config }: EditorProps) {
  const { containerRef } = useEditor(config);

  return <div ref={containerRef} className={className} style={style} id={id} />;
}
