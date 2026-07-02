import type { Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { NexusPlugin } from "@floatboat/nexus-core";

/**
 * Typewriter scrolling: keep the cursor line vertically centered (cf.
 * iA Writer / Obsidian) so the writer's eyes stay fixed mid-screen while
 * the text moves.
 *
 * ## Why this writes `scrollDOM.scrollTop` directly (design note)
 *
 * The obvious implementation — dispatching
 * `EditorView.scrollIntoView(head, { y: "center" })` after each edit — is
 * subtly broken, because CM6 keeps only ONE pending scroll target and every
 * native input transaction overwrites it with a `y: "nearest"` request.
 * "nearest" is a no-op while the cursor is visible but bottom-aligns when
 * the cursor moves off-screen. That interaction creates two self-sustaining
 * regimes:
 *
 * - **Bottom-locked**: cursor at the bottom edge → each Enter pushes it
 *   off-screen → "nearest" performs a real (bottom-aligning) scroll and
 *   races our "center" request; under fast repeated input the center
 *   request loses (its coordinates may not even be measurable yet —
 *   `docView.scrollIntoView` silently drops targets whose coords resolve
 *   to null) → the cursor stays glued to the bottom.
 * - **Center-locked**: once a single center scroll succeeds (e.g. the user
 *   pauses or presses an arrow key), the cursor is mid-screen, every
 *   subsequent "nearest" is a no-op, and centering wins forever.
 *
 * Observed exactly this way in the Electron demo: holding Enter kept the
 * cursor bottom-locked until one ArrowUp flipped the system into the
 * center-locked regime.
 *
 * The fix: don't compete for the scroll-target slot at all. A
 * `view.requestMeasure({ read, write })` cycle reads the cursor's measured
 * offset from the scroller's vertical center and writes the correction
 * straight to `scrollDOM.scrollTop`. This CONVERGES regardless of ordering:
 * if "nearest" scrolls first we re-center right after; once centered,
 * "nearest" never fires again. `key: this` coalesces multiple updates per
 * frame into one measure pass.
 *
 * `ViewPlugin` lifecycle is fully managed by CodeMirror; the `destroyed`
 * flag makes a measure pass that resolves after teardown (or after a
 * runtime `removePlugin`) a no-op, so hot-uninstall leaves zero residue.
 */
function typewriterScroll(): Extension {
  return ViewPlugin.fromClass(
    class {
      private destroyed = false;

      update(update: ViewUpdate): void {
        if (!update.docChanged && !update.selectionSet) return;
        const view = update.view;
        view.requestMeasure({
          key: this,
          read: (measuredView: EditorView): number | null => {
            if (this.destroyed) return null;
            const head = measuredView.state.selection.main.head;
            const cursor = measuredView.coordsAtPos(head);
            if (!cursor) return null;
            const scroller = measuredView.scrollDOM.getBoundingClientRect();
            const cursorCenter = cursor.top + (cursor.bottom - cursor.top) / 2;
            const scrollerCenter = scroller.top + (scroller.bottom - scroller.top) / 2;
            return cursorCenter - scrollerCenter;
          },
          write: (offset: number | null, measuredView: EditorView): void => {
            if (this.destroyed || offset === null) return;
            // Sub-pixel corrections aren't visible; skip them to avoid
            // dirtying the scroll position on every keystroke once centered.
            if (Math.abs(offset) < 1) return;
            measuredView.scrollDOM.scrollTop += offset;
          },
        });
      }

      destroy(): void {
        this.destroyed = true;
      }
    }
  );
}

/**
 * Create the typewriter plugin. Declares only hot-pluggable hooks
 * (`cmExtensions`), so it can be installed and removed at runtime via
 * `editor.addPlugin(...)` / `editor.removePlugin("plugin-typewriter")`.
 */
export function createTypewriterPlugin(): NexusPlugin {
  return {
    name: "plugin-typewriter",
    cmExtensions: [typewriterScroll()],
  };
}
