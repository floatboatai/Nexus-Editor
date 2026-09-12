import type { EditorView } from "@codemirror/view";
import { pickOverlayMount } from "./toolbar-dom";

const THEME_PROPERTIES = ["--nexus-bg", "--nexus-bg-muted", "--nexus-border", "--nexus-border-subtle", "--nexus-text", "--nexus-text-muted", "--nexus-accent"];

/** Position against the visible editor bounds; return false when the anchor cannot be shown. */
export function positionSelectionToolbar(view: EditorView, editorRoot: HTMLElement, element: HTMLElement): boolean {
  const window = editorRoot.ownerDocument.defaultView!;
  const selection = view.state.selection.main;
  const head = view.coordsAtPos(selection.head, selection.head === selection.to ? -1 : 1);
  const anchor = view.coordsAtPos(selection.anchor, selection.anchor === selection.to ? -1 : 1);
  if (!head) return false;
  const root = editorRoot.getBoundingClientRect();
  const scroll = view.scrollDOM.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = Math.max(root.left, scroll.left, viewport?.offsetLeft ?? 0) + 8;
  const right = Math.min(root.right, scroll.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth)) - 8;
  const top = Math.max(root.top, scroll.top, viewport?.offsetTop ?? 0) + 8;
  const bottom = Math.min(root.bottom, scroll.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight)) - 8;
  if (head.bottom < top || head.top > bottom || head.left < left - 8 || head.left > right + 8 || right <= left || bottom <= top) return false;
  const mount = pickOverlayMount(editorRoot);
  if (element.parentElement !== mount) mount.appendChild(element);
  const theme = window.getComputedStyle(view.dom);
  for (const property of THEME_PROPERTIES) {
    const value = theme.getPropertyValue(property);
    if (value) element.style.setProperty(property, value);
    else element.style.removeProperty(property);
  }
  element.hidden = false;
  element.style.display = "flex";
  element.style.maxWidth = `${right - left}px`;
  const { width, height } = element.getBoundingClientRect();
  if (height > bottom - top) return false;
  const singleLine = anchor && Math.abs(anchor.top - head.top) < 2;
  const center = singleLine ? (anchor.left + head.left) / 2 : head.left;
  // Forward multiline selection ends below selected text; a reversed one ends above it.
  const preferBelow = !singleLine && selection.head > selection.anchor;
  const above = head.top - height - 8;
  const below = head.bottom + 8;
  let y = preferBelow ? below : above;
  if (y < top) y = below;
  if (y + height > bottom) y = above;
  element.style.left = `${Math.max(left, Math.min(center - width / 2, right - width))}px`;
  element.style.top = `${Math.max(top, Math.min(y, bottom - height))}px`;
  return true;
}
