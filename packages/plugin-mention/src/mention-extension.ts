/**
 * CodeMirror 6 ViewPlugin for @mention detection, floating menu, and keyboard navigation.
 */

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { EditorAPI } from "@floatboat/nexus-core";
import type {
  MentionItem,
  MentionMenuState,
  MentionPluginConfig,
  MentionViewState,
} from "./mention-types";
import { createMentionMenu, updateMenuSelection, type MentionMenuElements } from "./mention-menu";

const DEFAULT_CONFIG = {
  trigger: "@",
  limit: 8,
  minQueryLength: 0,
  debounceMs: 150,
  flip: true,
  closeOnBlur: true,
} as const;

class TriggerMarkerWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "nexus-mention-trigger-marker";
    span.textContent = "\u200b";
    return span;
  }
  eq(): boolean { return true; }
  ignoreEvent(): boolean { return true; }
}

function buildConfig(opts: MentionPluginConfig): Required<MentionPluginConfig> {
  return { ...DEFAULT_CONFIG, ...opts } as Required<MentionPluginConfig>;
}

export function isWordBoundary(doc: string, pos: number): boolean {
  if (pos <= 0 || pos >= doc.length) return true;
  const prev = doc.charAt(pos - 1);
  return /\s|[!"#$%&'()*+,-./:;<=>?@[\\\]^_`{|}~]/.test(prev);
}

export function getTriggerPos(doc: string, cursor: number, trigger: string): number | null {
  let pos = cursor - 1;
  while (pos >= 0 && doc.charAt(pos) !== trigger) {
    if (/\s/.test(doc.charAt(pos))) return null;
    pos--;
  }
  if (pos < 0) return null;
  if (!isWordBoundary(doc, pos)) return null;
  return pos;
}

export function getQueryText(doc: string, triggerPos: number, cursor: number): string {
  return doc.slice(triggerPos + 1, cursor);
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

export function createMentionExtension(editor: EditorAPI, rawConfig: MentionPluginConfig) {
  const config = buildConfig(rawConfig);

  return ViewPlugin.fromClass(
    class {
      private readonly view: EditorView;
      private readonly state: MentionViewState;
      private menuElements: MentionMenuElements | null = null;
      private decorations: DecorationSet = Decoration.none;

      constructor(view: EditorView) {
        this.view = view;
        this.state = {
          open: false, triggerPos: -1, query: "", items: [],
          selectedIndex: 0, coords: null, abortController: null, timer: null,
        };
        this.checkCursor(view);
      }

      update(update: ViewUpdate): void {
        if (update.selectionSet || update.docChanged || update.viewportChanged) {
          this.checkCursor(update.view);
        }
      }

      destroy(): void { this.closeMenu(); }

      private checkCursor(view: EditorView): void {
        const selection = view.state.selection.main;
        if (!selection.empty) { this.closeMenu(); return; }

        const cursor = selection.head;
        const doc = view.state.doc.toString();
        const triggerPos = getTriggerPos(doc, cursor, config.trigger);

        if (triggerPos === null) { this.closeMenu(); return; }

        const query = getQueryText(doc, triggerPos, cursor);

        if (query.length < config.minQueryLength) {
          if (this.state.open) {
            this.updateState({ query, items: [], selectedIndex: 0 });
            this.renderMenu(view);
          }
          return;
        }

        if (this.state.open && this.state.triggerPos === triggerPos && this.state.query === query) {
          return;
        }

        this.updateState({ triggerPos, query, selectedIndex: 0 });
        this.scheduleQuery(view, query);
      }

      private scheduleQuery(view: EditorView, query: string): void {
        this.cancelPending();
        this.state.timer = setTimeout(() => { this.runQuery(view, query); }, config.debounceMs);
      }

      private async runQuery(view: EditorView, query: string): Promise<void> {
        const ac = new AbortController();
        this.state.abortController = ac;
        try {
          const result = await Promise.resolve(config.query(query));
          if (ac.signal.aborted) return;
          const items = result.slice(0, config.limit);
          this.updateState({ items, selectedIndex: 0 });
          this.renderMenu(view);
        } catch {
          this.updateState({ items: [], selectedIndex: 0 });
          this.renderMenu(view);
        }
      }

      private cancelPending(): void {
        if (this.state.timer) { clearTimeout(this.state.timer); this.state.timer = null; }
        if (this.state.abortController) { this.state.abortController.abort(); this.state.abortController = null; }
      }

      private updateState(partial: Partial<MentionViewState>): void {
        Object.assign(this.state, partial);
      }

      private renderMenu(view: EditorView): void {
        this.closeMenu();
        const coords = view.coordsAtPos(this.state.triggerPos);
        if (!coords) { this.closeMenu(); return; }

        this.state.coords = { left: coords.left, top: coords.top, bottom: coords.bottom };
        this.menuElements = createMentionMenu(this.state.items, this.state.selectedIndex, config.renderItem);

        const menu = this.menuElements.root;
        menu.style.position = "absolute";
        menu.style.left = `${coords.left}px`;
        menu.style.top = `${coords.bottom + 4}px`;
        menu.style.zIndex = "1000";

        if (config.flip) {
          requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            const viewportH = window.innerHeight;
            if (rect.bottom > viewportH && coords.top - rect.height > 0) {
              menu.style.top = `${coords.top - rect.height - 4}px`;
            }
          });
        }

        const editorDom = view.dom.closest(".cm-editor") as HTMLElement | null;
        const container = editorDom ?? view.dom;
        container.style.position = "relative";
        container.appendChild(menu);

        menu.addEventListener("mousedown", (e) => e.preventDefault());
        menu.addEventListener("click", (e) => this.handleMenuClick(e, view));

        const dec = Decoration.widget({ widget: new TriggerMarkerWidget(), side: 1 })
          .range(this.state.triggerPos);
        this.decorations = Decoration.set([dec]);
        this.emitState(view);
      }

      private closeMenu(): void {
        this.cancelPending();
        if (this.menuElements) { this.menuElements.root.remove(); this.menuElements = null; }
        this.decorations = Decoration.none;
        if (this.state.open) { this.state.open = false; this.emitState(this.view); }
      }

      private emitState(view: EditorView): void {
        const evt: MentionMenuState = {
          isOpen: this.state.open, query: this.state.query,
          items: this.state.items, selectedIndex: this.state.selectedIndex,
          coords: this.state.coords,
        };
        (editor as any).emit?.("mentionMenuChange", evt);
      }

      private handleMenuClick(e: MouseEvent, view: EditorView): void {
        const target = (e.target as HTMLElement).closest("[data-index]") as HTMLElement | null;
        if (!target) return;
        const index = parseInt(target.dataset.index ?? "0", 10);
        this.confirm(index, view);
      }

      private confirm(itemIndex: number, view: EditorView): void {
        const item = this.state.items[itemIndex];
        if (!item) return;
        const insertText = config.insertFormat ? config.insertFormat(item) : `[@${item.name}](${item.id})`;
        const from = this.state.triggerPos;
        const to = view.state.selection.main.head;
        view.dispatch({
          changes: { from, to, insert: insertText },
          selection: EditorSelection.cursor(from + insertText.length),
        });
        this.closeMenu();
      }

      navigate(direction: "previous" | "next", view: EditorView): boolean {
        if (!this.state.open || this.state.items.length === 0) return false;
        const delta = direction === "previous" ? -1 : 1;
        const nextIndex = clampIndex(this.state.selectedIndex + delta, this.state.items.length);
        this.state.selectedIndex = nextIndex;
        if (this.menuElements) { updateMenuSelection(this.menuElements, nextIndex, this.state.items); }
        this.emitState(view);
        return true;
      }

      accept(view: EditorView): boolean {
        if (!this.state.open) return false;
        this.confirm(this.state.selectedIndex, view);
        return true;
      }

      dismiss(): boolean {
        if (!this.state.open) return false;
        this.closeMenu();
        return true;
      }
    },
    { decorations: (v) => (v as any)["decorations"] }
  );
}

export const mentionKeymap = [
  { key: "ArrowUp", run: (view) => (view.plugin(createMentionExtension as any)?.navigate("previous", view) ?? false) },
  { key: "ArrowDown", run: (view) => (view.plugin(createMentionExtension as any)?.navigate("next", view) ?? false) },
  { key: "Enter", run: (view) => (view.plugin(createMentionExtension as any)?.accept(view) ?? false) },
  { key: "Tab", run: (view) => (view.plugin(createMentionExtension as any)?.accept(view) ?? false) },
  { key: "Escape", run: (view) => (view.plugin(createMentionExtension as any)?.dismiss() ?? false) },
];
