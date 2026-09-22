import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

export interface CollabUser {
  /** Display name of the user, rendered above the remote cursor */
  name: string;
  /** Primary theme color for the user's cursor and selection border (hex or css color) */
  color: string;
  /** Lighter background tint for user selection highlights */
  colorLight?: string;
  /** Optional user avatar URL or initials */
  avatar?: string;
}

export interface CollabPluginOptions {
  /**
   * The shared Y.Text type in the Y.Doc where document content is synced.
   */
  ytext: Y.Text;

  /**
   * The Awareness protocol instance used for tracking remote user presence,
   * live cursor positions, and selections.
   */
  awareness?: Awareness;

  /**
   * Current local user presence profile. When provided, automatically updates
   * the local awareness state.
   */
  user?: CollabUser;

  /**
   * Collaborative UndoManager. When provided or set to true, binds Ctrl+Z / Ctrl+Y
   * to undo/redo only the changes made by the local client, preventing accidental
   * rollback of other users' edits.
   * Set to `false` to disable.
   */
  undoManager?: Y.UndoManager | false;

  /**
   * Initial document value to seed into Y.Text if Y.Text is currently empty.
   */
  initialValue?: string;
}
