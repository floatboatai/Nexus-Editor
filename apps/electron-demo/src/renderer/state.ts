import type { LinkIndex } from "./link-index";
import type { NoteVaultNode } from "@floatboat/nexus-core";

export interface AppState {
  filePath: string | null;
  content: string;
  dirty: boolean;
  error: string | null;
  vaultPath: string | null;
  vaultTree: NoteVaultNode[];
  activeFile: string | null;
  linkIndex: LinkIndex | null;
}

export function createState(): AppState {
  return {
    filePath: null,
    content: "",
    dirty: false,
    error: null,
    vaultPath: null,
    vaultTree: [],
    activeFile: null,
    linkIndex: null,
  };
}
