import type { LinkIndex } from "./link-index";
import type { SnapshotEntry } from "../../electron/snapshots";

export interface AppState {
  filePath: string | null;
  content: string;
  dirty: boolean;
  error: string | null;
  vaultPath: string | null;
  vaultTree: VaultNode[];
  activeFile: string | null;
  linkIndex: LinkIndex | null;
  snapshots: SnapshotEntry[];
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
    snapshots: [],
  };
}
