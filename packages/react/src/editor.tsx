import { useEditor } from "./use-editor";

import type { EditorProps } from "./types";

export function Editor({ containerProps, ...config }: EditorProps) {
  const { containerRef } = useEditor(config);

  return <div ref={containerRef} {...containerProps} />;
}
