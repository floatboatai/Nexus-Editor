import { EditorState } from "@codemirror/state";
import { EditorView, keymap, dropCursor } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { closeBrackets } from "@codemirror/autocomplete";
import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { EventEmitter } from "./event-emitter";
import { createLivePreviewExtension } from "./live-preview";
import { computeSlashState } from "./slash-state";
import type { EditorAPI, EditorConfig, EditorEventMap, NexusPlugin, ParserLike } from "./types";
import { createWidgetExtension } from "./widget-extension";

function createEmptyAst(): Root {
  return {
    type: "root",
    children: []
  };
}

function parseDocument(parser: ParserLike, markdown: string): Root {
  try {
    return parser.parse(markdown);
  } catch {
    return createEmptyAst();
  }
}

function createParser(plugins: NexusPlugin[]): ParserLike {
  return {
    parse(markdown) {
      const processor = unified().use(remarkParse);

      for (const plugin of plugins) {
        for (const remarkPlugin of plugin.remarkPlugins ?? []) {
          processor.use(remarkPlugin);
        }
      }

      const tree = processor.parse(markdown);
      return processor.runSync(tree) as Root;
    }
  };
}

export function createEditor(config: EditorConfig): EditorAPI {
  const plugins = config.plugins ?? [];
  const parser = config.parser ?? createParser(plugins);
  const shortcuts = plugins.flatMap((plugin) => plugin.shortcuts ?? []);
  const slashCommands = plugins.flatMap((plugin) => plugin.slashCommands ?? []);
  const cmExtensions = plugins.flatMap((plugin) => plugin.cmExtensions ?? []);
  const widgetDefs = plugins.flatMap((plugin) => plugin.widgets ?? []);
  const parseDelayMs = config.parseDelayMs ?? 0;
  const emitter = new EventEmitter<EditorEventMap>();
  let destroyed = false;
  let focused = false;
  let parseTimer: ReturnType<typeof setTimeout> | undefined;
  let currentAst = parseDocument(parser, config.initialValue ?? "");
  let api!: EditorAPI;

  function setFocused(next: boolean) {
    if (destroyed || focused === next) {
      return;
    }

    focused = next;

    if (next) {
      config.onFocus?.();
      emitter.emit("focus");
      return;
    }

    config.onBlur?.();
    emitter.emit("blur");
  }

  function emitChange(markdown: string) {
    if (destroyed) {
      return;
    }

    currentAst = parseDocument(parser, markdown);
    config.onChange?.(markdown, currentAst);
    emitter.emit("change", markdown, currentAst);
  }

  function scheduleChange(markdown: string) {
    if (parseTimer) {
      clearTimeout(parseTimer);
      parseTimer = undefined;
    }

    if (parseDelayMs <= 0) {
      emitChange(markdown);
      return;
    }

    parseTimer = setTimeout(() => {
      parseTimer = undefined;
      emitChange(markdown);
    }, parseDelayMs);
  }

  const shortcutExtensions =
    shortcuts.length > 0
      ? [
          keymap.of(
            shortcuts.map((shortcut) => ({
              key: shortcut.key,
              run: () => shortcut.run(api)
            }))
          )
        ]
      : [];

  const view = new EditorView({
    parent: config.container,
    state: EditorState.create({
      doc: config.initialValue ?? "",
      extensions: [
        EditorView.domEventHandlers({
          focus() {
            setFocused(true);
            return false;
          },
          blur() {
            setFocused(false);
            return false;
          }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            scheduleChange(update.state.doc.toString());
          }

          if ((update.selectionSet || update.docChanged) && !destroyed) {
            const sel = update.state.selection.main;

            if (update.selectionSet) {
              emitter.emit("selectionChange", { anchor: sel.anchor, head: sel.head });
            }

            if (slashCommands.length > 0) {
              const doc = update.state.doc.toString();
              const state = computeSlashState(doc, sel.head, slashCommands);
              let coords: { left: number; top: number; bottom: number } | null = null;

              if (state.isOpen && state.from !== null) {
                try {
                  const raw = update.view.coordsAtPos(state.from);
                  if (raw) {
                    coords = { left: raw.left, top: raw.top, bottom: raw.bottom };
                  }
                } catch { /* out of range */ }
              }

              emitter.emit("slashMenuChange", { ...state, coords });
            }
          }
        }),
        keymap.of([indentWithTab]),
        closeBrackets(),
        dropCursor(),
        EditorView.domEventHandlers({
          drop(event) {
            if (!config.onAssetUpload || destroyed) return false;
            const files = event.dataTransfer?.files;
            if (!files || files.length === 0) return false;

            event.preventDefault();
            for (const file of Array.from(files)) {
              config.onAssetUpload(file).then((url) => {
                if (url) {
                  const isImage = file.type.startsWith("image/");
                  const md = isImage ? `![${file.name}](${url})` : `[${file.name}](${url})`;
                  view.dispatch(view.state.replaceSelection(md));
                }
              });
            }
            return true;
          },
          paste(event) {
            if (!config.onAssetUpload || destroyed) return false;
            const files = event.clipboardData?.files;
            if (!files || files.length === 0) return false;

            event.preventDefault();
            for (const file of Array.from(files)) {
              config.onAssetUpload(file).then((url) => {
                if (url) {
                  const isImage = file.type.startsWith("image/");
                  const md = isImage ? `![${file.name}](${url})` : `[${file.name}](${url})`;
                  view.dispatch(view.state.replaceSelection(md));
                }
              });
            }
            return true;
          },
        }),
        ...createLivePreviewExtension(parser, config.livePreview),
        ...createWidgetExtension(parser, widgetDefs),
        ...shortcutExtensions,
        ...cmExtensions
      ]
    })
  });

  api = {
    getDocument() {
      return view.state.doc.toString();
    },
    getAst() {
      return currentAst;
    },
    getSelection() {
      const sel = view.state.selection.main;
      return { anchor: sel.anchor, head: sel.head };
    },
    getSlashCommands() {
      return slashCommands;
    },
    uploadAsset(file) {
      if (destroyed || !config.onAssetUpload) {
        return Promise.resolve(null);
      }

      return config.onAssetUpload(file);
    },
    setSelection(anchor, head = anchor) {
      if (destroyed) {
        return;
      }

      view.dispatch({
        selection: { anchor, head }
      });
    },
    setDocument(next) {
      if (destroyed) {
        return;
      }

      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: next
        }
      });
    },
    replaceSelection(text) {
      if (destroyed) return;
      view.dispatch(view.state.replaceSelection(text));
    },
    focus() {
      if (destroyed) {
        return;
      }

      view.focus();
      setFocused(true);
    },
    blur() {
      if (destroyed) {
        return;
      }

      view.contentDOM.blur();
      setFocused(false);
    },
    runShortcut(key) {
      if (destroyed) {
        return false;
      }

      const shortcut = shortcuts.find((entry) => entry.key === key);
      return shortcut ? shortcut.run(api) : false;
    },
    on(event, handler) {
      emitter.on(event, handler);
    },
    off(event, handler) {
      emitter.off(event, handler);
    },
    getCoordsAtPos(pos) {
      if (destroyed) return null;
      try {
        return view.coordsAtPos(pos);
      } catch {
        return null;
      }
    },
    getDocumentStats() {
      const doc = view.state.doc.toString();
      const characters = doc.length;
      const words = doc.trim() === "" ? 0 : doc.trim().split(/\s+/).length;
      const lines = view.state.doc.lines;
      return { characters, words, lines };
    },
    destroy() {
      destroyed = true;
      focused = false;
      if (parseTimer) {
        clearTimeout(parseTimer);
        parseTimer = undefined;
      }
      emitter.clear();
      view.destroy();
    }
  };

  return api;
}
