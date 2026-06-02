import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion
} from "@codemirror/autocomplete";
import { StateEffect, StateField, type Extension, type Range, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin } from "@codemirror/view";

import type { NexusPlugin } from "./types";

const COMPOSITION_REDECORATE_DELAY_MS = 60;

/**
 * Obsidian-style bidirectional wiki link extension.
 *
 * Syntax:
 *   [[target]]              — plain link, visible text = "target"
 *   [[target|alias]]        — aliased link, visible text = "alias"
 *
 * Escape:
 *   \[[NotALink]]           — literal, no decoration
 *
 * The extension is resource-agnostic. Host code supplies:
 *   - resolve(name, fromPath) : returns a non-null target path when the link
 *     can be resolved; null/undefined marks the link "unresolved".
 *   - onNavigate(target, opts) : invoked exactly once per click.
 *   - suggest(query)          : returns candidates for autocomplete after `[[`.
 *
 * Decoration strategy (click-drift-safe):
 *   - Uses ONLY Decoration.mark + zero-width Decoration.replace. No widgets,
 *     no height-changing styles (matches the invariants documented in
 *     live-preview.ts:283-293 and CLAUDE.md).
 *   - Markers are hidden only when the cursor is off the same line as the
 *     wikilink — same policy as inline strong/emphasis/link.
 */

export interface WikiLinkMatch {
  /** Absolute document offset of the opening `[`. */
  from: number;
  /** Absolute document offset after the closing `]`. */
  to: number;
  /** Raw target text between `[[` and `|` or `]]`. */
  target: string;
  /** Alias text when `|alias` was present; otherwise undefined. */
  alias?: string;
  /** The visible text: alias when present, otherwise target. */
  display: string;
  /** Offset of the first character of `display` within the document. */
  displayFrom: number;
  /** Offset just after the last character of `display`. */
  displayTo: number;
}

export interface WikiLinkNavigateOptions {
  unresolved: boolean;
}

export interface WikilinksOptions {
  /** Return a non-null path when `name` resolves; null → unresolved. */
  resolve?: (name: string) => string | null | undefined;
  /** Fired on click; opts.unresolved is true when resolve() returned null. */
  onNavigate?: (target: string, opts: WikiLinkNavigateOptions) => void;
  /** Return candidates (basenames or targets) for autocomplete after `[[`. */
  suggest?: (query: string) => string[] | Promise<string[]>;
  /** Return true for host-specific double-bracket tokens that should stay literal. */
  ignore?: (target: string) => boolean;
}

// Must disallow: nested `[`/`]`, pipes in target, newlines.
// Leading `(?<!\\)` skips escaped `\[[`.
const WIKILINK_RE = /(?<!\\)\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

/**
 * Scan a document string for all wiki links. Pure, side-effect-free.
 * Ordering: ascending `from`.
 */
export function scanWikiLinks(doc: string): WikiLinkMatch[] {
  const out: WikiLinkMatch[] = [];
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(doc)) !== null) {
    const from = match.index;
    const source = match[0];
    const to = from + source.length;
    const target = match[1].trim();
    const alias = match[2]?.trim();
    if (!target) continue;

    const display = alias && alias.length > 0 ? alias : target;
    // Layout: `[[` rawTarget [ `|` rawAlias ] `]]`
    // rawTarget = match[1] (pre-trim); rawAlias = match[2] (pre-trim, may be undefined).
    const rawTarget = match[1];
    const rawAlias = match[2];
    let displayFrom: number;
    let displayTo: number;
    if (rawAlias !== undefined) {
      const aliasStart = from + 2 + rawTarget.length + 1;
      const leading = rawAlias.length - rawAlias.trimStart().length;
      displayFrom = aliasStart + leading;
      displayTo = displayFrom + display.length;
    } else {
      const leading = rawTarget.length - rawTarget.trimStart().length;
      displayFrom = from + 2 + leading;
      displayTo = displayFrom + display.length;
    }

    out.push({ from, to, target, alias, display, displayFrom, displayTo });
  }
  return out;
}

function lineBoundaries(doc: string, pos: number): { start: number; end: number } {
  const start = doc.lastIndexOf("\n", pos - 1) + 1;
  const nl = doc.indexOf("\n", pos);
  return { start, end: nl === -1 ? doc.length : nl };
}

function selectionOnLine(
  doc: string,
  from: number,
  to: number,
  selectionHeads: readonly number[]
): boolean {
  const nodeLineStart = doc.lastIndexOf("\n", from - 1) + 1;
  const nl = doc.indexOf("\n", to);
  const nodeLineEnd = nl === -1 ? doc.length : nl;
  for (const head of selectionHeads) {
    if (head >= nodeLineStart && head <= nodeLineEnd) return true;
  }
  return false;
}

const RESOLVED_STYLE =
  "color:var(--nexus-accent);cursor:pointer;text-decoration:underline;text-decoration-color:var(--nexus-accent);text-decoration-thickness:1px;";
const UNRESOLVED_STYLE =
  "color:var(--nexus-hl-deletion,#c0392b);cursor:pointer;text-decoration:underline dashed;text-decoration-thickness:1px;";

function buildWikiLinkDecorations(
  doc: string,
  selectionHeads: readonly number[],
  resolve: WikilinksOptions["resolve"],
  ignore: WikilinksOptions["ignore"]
): DecorationSet {
  const matches = scanWikiLinks(doc);
  if (matches.length === 0) return Decoration.none;

  const decos: Range<Decoration>[] = [];
  for (const m of matches) {
    if (ignore?.(m.target)) continue;
    const unresolved = resolve ? !resolve(m.target) : false;
    const style = unresolved ? UNRESOLVED_STYLE : RESOLVED_STYLE;
    const attrs: Record<string, string> = {
      style,
      "data-wikilink-target": m.target,
    };
    if (unresolved) attrs["data-wikilink-unresolved"] = "true";
    if (m.alias) attrs["data-wikilink-alias"] = m.alias;

    const onLine = selectionOnLine(doc, m.from, m.to, selectionHeads);

    if (onLine) {
      // Cursor on line → show raw `[[...]]` but still style the full span so
      // the user can see what they're editing. No replaces.
      decos.push(Decoration.mark({ attributes: attrs }).range(m.from, m.to));
      continue;
    }

    // Cursor off line → hide `[[`, `]]`, and (for aliased) the `target|` prefix.
    // Then mark the visible `display` text.
    // Replace from `from` up to `displayFrom`, and from `displayTo` up to `to`.
    if (m.displayFrom > m.from) {
      decos.push(Decoration.replace({}).range(m.from, m.displayFrom));
    }
    if (m.to > m.displayTo) {
      decos.push(Decoration.replace({}).range(m.displayTo, m.to));
    }
    if (m.displayTo > m.displayFrom) {
      decos.push(Decoration.mark({ attributes: attrs }).range(m.displayFrom, m.displayTo));
    }
  }

  // Deduplicate + sort: Decoration.set requires sorted ranges; zero-length
  // replaces at the same position are OK but must appear in `from` order.
  return Decoration.set(decos, true);
}

function findWikiContext(
  doc: string,
  pos: number
): { openFrom: number; query: string } | null {
  // Walk backwards on the current line to find the nearest unescaped `[[`
  // that has not yet been closed by `]]`.
  const { start, end: _end } = lineBoundaries(doc, pos);
  const line = doc.slice(start, pos);
  const openIdx = line.lastIndexOf("[[");
  if (openIdx < 0) return null;
  // Escaped? `\[[`
  if (openIdx > 0 && line[openIdx - 1] === "\\") return null;
  const between = line.slice(openIdx + 2);
  // Already closed on this line segment before the cursor → not inside an open link.
  if (between.includes("]]")) return null;
  // Disallow newlines inside query (shouldn't happen since we sliced a single line).
  if (between.includes("\n")) return null;
  // `|` starts the alias — we still provide completion for the target part.
  const queryPart = between.split("|")[0];
  return { openFrom: start + openIdx, query: queryPart };
}

function createAutocompleteSource(
  suggest: NonNullable<WikilinksOptions["suggest"]>
) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const pos = ctx.pos;
    const doc = ctx.state.doc.toString();
    const wk = findWikiContext(doc, pos);
    if (!wk) return null;
    const candidates = await Promise.resolve(suggest(wk.query));
    if (!candidates || candidates.length === 0) return null;
    const queryLower = wk.query.toLowerCase();
    const filtered = queryLower
      ? candidates.filter((c) => c.toLowerCase().includes(queryLower))
      : candidates;
    if (filtered.length === 0) return null;

    const options: Completion[] = filtered.slice(0, 50).map((name) => ({
      label: name,
      type: "text",
      apply(view, _completion, from, to) {
        // `from` is the start of the typed query (right after `[[`). We replace
        // from that point through the completion position `to`, and if the
        // user has no `]]` yet on this line past `to`, we append it.
        const after = view.state.doc.sliceString(to, Math.min(to + 2, view.state.doc.length));
        const needsClose = after !== "]]";
        const insert = needsClose ? `${name}]]` : name;
        view.dispatch({
          changes: { from, to, insert },
          selection: { anchor: from + insert.length },
        });
      },
    }));

    // Completion range starts right after `[[`.
    return {
      from: wk.openFrom + 2,
      to: pos,
      options,
      validFor: /^[^\[\]\n|]*$/,
    };
  };
}

export function createWikilinksExtension(options: WikilinksOptions = {}): Extension[] {
  const resolve = options.resolve;
  const onNavigate = options.onNavigate;
  const ignore = options.ignore;
  const rebuildAfterComposition = StateEffect.define<null>();

  // A small effect to force redecoration when the host announces the index has
  // changed (e.g. a new note was created elsewhere). Hosts do this by
  // dispatching an empty transaction; we recompute on every selection/doc
  // change anyway, so a no-op dispatch suffices. The extension doesn't need a
  // dedicated effect type for v1.
  const field = StateField.define<DecorationSet>({
    create(state) {
      const heads = state.selection.ranges.map((r) => r.head);
      return buildWikiLinkDecorations(state.doc.toString(), heads, resolve, ignore);
    },
    update(decos: DecorationSet, tr: Transaction) {
      if (tr.effects.some((effect) => effect.is(rebuildAfterComposition))) {
        const heads = tr.state.selection.ranges.map((r) => r.head);
        return buildWikiLinkDecorations(tr.state.doc.toString(), heads, resolve, ignore);
      }
      if (tr.isUserEvent("input.type.compose")) {
        return tr.docChanged ? decos.map(tr.changes) : decos;
      }
      if (tr.docChanged || tr.selection) {
        const heads = tr.state.selection.ranges.map((r) => r.head);
        return buildWikiLinkDecorations(tr.state.doc.toString(), heads, resolve, ignore);
      }
      return decos;
    },
    provide(f) {
      return EditorView.decorations.from(f);
    },
  });

  const viewCapture = ViewPlugin.fromClass(
    class {
      compositionTimer: ReturnType<typeof setTimeout> | null = null;
      destroy(): void {
        if (this.compositionTimer !== null) {
          clearTimeout(this.compositionTimer);
          this.compositionTimer = null;
        }
      }
    },
  );

  const compositionHandler = EditorView.domEventHandlers({
    compositionend(_event, view) {
      const plugin = view.plugin(viewCapture);
      if (!plugin) return;
      if (plugin.compositionTimer) clearTimeout(plugin.compositionTimer);
      plugin.compositionTimer = setTimeout(() => {
        plugin.compositionTimer = null;
        if (view.compositionStarted) return;
        try {
          view.dispatch({ effects: rebuildAfterComposition.of(null) });
        } catch {
          // The editor may already be gone by the time the IME cleanup runs.
        }
      }, COMPOSITION_REDECORATE_DELAY_MS);
      return false;
    },
  });

  const clickHandler = EditorView.domEventHandlers({
    mousedown(event, _view) {
      if (!onNavigate) return false;
      const el = (event.target as HTMLElement)?.closest?.("[data-wikilink-target]");
      if (!el) return false;
      const target = el.getAttribute("data-wikilink-target");
      if (!target) return false;
      if (ignore?.(target)) return false;
      const unresolved = el.getAttribute("data-wikilink-unresolved") === "true";
      event.preventDefault();
      event.stopPropagation();
      onNavigate(target, { unresolved });
      return true;
    },
  });

  const exts: Extension[] = [field, viewCapture, compositionHandler, clickHandler];

  if (options.suggest) {
    exts.push(
      autocompletion({
        override: [createAutocompleteSource(options.suggest)],
        activateOnTyping: true,
      })
    );
  }

  return exts;
}

/**
 * NexusPlugin wrapper so hosts can pass wiki links through `plugins: [...]`
 * instead of inlining `cmExtensions`.
 */
export function createWikilinksPlugin(options: WikilinksOptions = {}): NexusPlugin {
  return {
    name: "wikilinks",
    cmExtensions: createWikilinksExtension(options),
  };
}
