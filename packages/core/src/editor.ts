import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import type { EditorAPI, EditorConfig, NexusPlugin, ParserLike } from "./types";

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
  const parseDelayMs = config.parseDelayMs ?? 0;
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
      return;
    }

    config.onBlur?.();
  }

  function emitChange(markdown: string) {
    if (destroyed) {
      return;
    }

    currentAst = parseDocument(parser, markdown);
    config.onChange?.(markdown, currentAst);
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
        }),
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
    getSlashCommands() {
      return slashCommands;
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
    destroy() {
      destroyed = true;
      focused = false;
      if (parseTimer) {
        clearTimeout(parseTimer);
        parseTimer = undefined;
      }
      view.destroy();
    }
  };

  return api;
}
