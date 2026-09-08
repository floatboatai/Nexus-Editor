import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion
} from "@codemirror/autocomplete";
import { StateEffect, StateField, type Extension, type Range, type Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

import type { NexusPlugin } from "./types";

const COMPOSITION_REDECORATE_DELAY_MS = 60;
const ATX_HEADING_RE = /^(\s{0,3})(#{1,6})\s+(.+?)\s*#*\s*$/;
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9_-]+)(?=\s|$)/;

/**
 * Obsidian-style bidirectional wiki link extension.
 *
 * Syntax:
 *   [[target]]              — plain link, visible text = "target"
 *   [[target|alias]]        — aliased link, visible text = "alias"
 *   [[target#heading]]      — file + heading anchor
 *   [[target^block-id]]     — file + block reference
 *   [[#heading]]            — heading in the current file
 *
 * Escape:
 *   \[[NotALink]]           — literal, no decoration
 *
 * The extension is resource-agnostic. Host code supplies:
 *   - resolve(name)         : non-null path when the link resolves; null marks unresolved.
 *   - onNavigate(target, opts) : invoked exactly once per click.
 *   - suggest(query)        : note-name candidates after `[[`.
 *   - suggestAnchors(ctx)   : heading / block-id candidates after `[[note#` / `[[note^`.
 *
 * Decoration strategy (click-drift-safe):
 *   - Uses ONLY Decoration.mark + zero-width Decoration.replace. No widgets,
 *     no height-changing styles (matches the invariants documented in
 *     live-preview.ts:283-293 and CLAUDE.md).
 *   - Markers are hidden only when the cursor is off the same line as the
 *     wikilink — same policy as inline strong/emphasis/link.
 */

export type WikiLinkAnchor =
  | { kind: "heading"; value: string }
  | { kind: "block"; value: string };

export interface WikiLinkMatch {
  /** Absolute document offset of the opening `[`. */
  from: number;
  /** Absolute document offset after the closing `]`. */
  to: number;
  /** Raw target text between `[[` and `|` or `]]`. */
  target: string;
  /** File / note path with any `#heading` / `^block` anchor stripped. Empty for same-file jumps. */
  path: string;
  /** Heading or block anchor, when present. */
  anchor: WikiLinkAnchor | null;
  /** Alias text when `|alias` was present; otherwise undefined. */
  alias?: string;
  /** The visible text: alias when present, otherwise target (or heading for `[[#H]]`). */
  display: string;
  /** Offset of the first character of `display` within the document. */
  displayFrom: number;
  /** Offset just after the last character of `display`. */
  displayTo: number;
}

export interface WikiLinkNavigateOptions {
  unresolved: boolean;
  /** Bare path portion of the target; empty for `[[#heading]]`. */
  path: string;
  /** Parsed heading / block anchor, or null when the target has none. */
  anchor: WikiLinkAnchor | null;
}

export interface WikiLinkAnchorSuggestContext {
  /** Note path typed before `#` / `^`. Empty when completing a same-file jump. */
  path: string;
  kind: WikiLinkAnchor["kind"];
  /** Text typed after the `#` / `^` marker. */
  query: string;
}

export interface WikilinksOptions {
  /** Return a non-null path when `name` resolves; null → unresolved. */
  resolve?: (name: string) => string | null | undefined;
  /** Fired on click; opts.unresolved is true when resolve() returned null. */
  onNavigate?: (target: string, opts: WikiLinkNavigateOptions) => void;
  /** Return candidates (basenames or targets) for autocomplete after `[[`. */
  suggest?: (query: string) => string[] | Promise<string[]>;
  /**
   * Return heading / block-id candidates after `[[note#` or `[[note^`.
   * Same-file jumps (`[[#`, `[[^`) pass an empty `path`.
   */
  suggestAnchors?: (ctx: WikiLinkAnchorSuggestContext) => string[] | Promise<string[]>;
  /** Return true for host-specific double-bracket tokens that should stay literal. */
  ignore?: (target: string) => boolean;
}

export interface WikiLinkTypingContext {
  openFrom: number;
  /** Raw text between `[[` and the cursor, excluding any `|alias` suffix. */
  query: string;
  /** Substring before `#` / `^`, or the whole query when no marker is present. */
  path: string;
  anchor: {
    kind: WikiLinkAnchor["kind"];
    query: string;
    /** Offset of the `#` / `^` marker inside `query`. */
    markerIndex: number;
  } | null;
}

// Must disallow: nested `[`/`]`, pipes in target, newlines.
// Leading `(?<!\\)` skips escaped `\[[`.
const WIKILINK_RE = /(?<!\\)\[\[([^\[\]\n|]+?)(?:\|([^\[\]\n]+?))?\]\]/g;

/**
 * Split a wiki-link target into the file path and its Obsidian-style anchor.
 * Heading anchors use `#`; block refs use `^`. The first marker wins, so a
 * heading value may itself contain `#` (`Parent#Child`) or a later `^`.
 */
export function parseWikiLinkTarget(target: string): { path: string; anchor: WikiLinkAnchor | null } {
  const hash = target.indexOf("#");
  const caret = target.indexOf("^");
  if (hash < 0 && caret < 0) return { path: target.trim(), anchor: null };

  const headingFirst = hash >= 0 && (caret < 0 || hash < caret);
  const cut = headingFirst ? hash : caret;
  const path = target.slice(0, cut).trim();
  const value = target.slice(cut + 1).trim();
  if (!value) return { path, anchor: null };
  return {
    path,
    anchor: headingFirst
      ? { kind: "heading", value }
      : { kind: "block", value },
  };
}

/** File / note identity with any `#heading` / `^block` suffix removed. */
export function stripWikiLinkAnchor(target: string): string {
  return parseWikiLinkTarget(target).path;
}

function normalizeHeadingText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Character offset of the line that matches an Obsidian heading / block
 * anchor, or null when nothing matches. Offsets point at line start so
 * `editor.setSelection(pos)` scrolls the target into view.
 *
 * Headings: ATX (`#`–`######`) only; `#Parent#Child` matches the last segment.
 * Blocks: first `^id` token bounded by whitespace or line edges.
 */
export function findAnchorPosition(content: string, anchor: WikiLinkAnchor): number | null {
  if (anchor.kind === "heading") {
    const segments = anchor.value.split("#").map((part) => part.trim()).filter(Boolean);
    if (segments.length === 0) return null;
    const needle = normalizeHeadingText(segments[segments.length - 1]);
    const lines = content.split("\n");
    let offset = 0;
    for (const line of lines) {
      const match = ATX_HEADING_RE.exec(line);
      if (match && normalizeHeadingText(match[3]) === needle) return offset;
      offset += line.length + 1;
    }
    return null;
  }

  const id = anchor.value;
  if (!id) return null;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\s)\\^${escaped}(?=\\s|$)`, "m");
  const match = pattern.exec(content);
  if (!match) return null;
  const matchIdx = match.index + (match[0].startsWith("^") ? 0 : 1);
  return content.lastIndexOf("\n", matchIdx - 1) + 1;
}

/** Unique ATX heading texts in document order (original spelling preserved). */
export function collectMarkdownHeadings(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    const match = ATX_HEADING_RE.exec(line);
    if (!match) continue;
    const text = match[3].trim();
    if (!text) continue;
    const key = normalizeHeadingText(text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** Unique `^block-id` tokens in document order. */
export function collectMarkdownBlockIds(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of content.split("\n")) {
    const match = BLOCK_ID_RE.exec(line);
    if (!match) continue;
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isUsableWikiTarget(path: string, anchor: WikiLinkAnchor | null): boolean {
  if (path.length > 0) return true;
  return Boolean(anchor?.value);
}

function isCurrentFileAnchor(path: string, anchor: WikiLinkAnchor | null): boolean {
  return path.length === 0 && Boolean(anchor?.value);
}

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
    const parsed = parseWikiLinkTarget(target);
    if (!isUsableWikiTarget(parsed.path, parsed.anchor)) continue;

    const rawTarget = match[1];
    const rawAlias = match[2];
    let display: string;
    let displayFrom: number;
    let displayTo: number;

    if (rawAlias !== undefined) {
      display = alias && alias.length > 0 ? alias : target;
      const aliasStart = from + 2 + rawTarget.length + 1;
      const leading = rawAlias.length - rawAlias.trimStart().length;
      displayFrom = aliasStart + leading;
      displayTo = displayFrom + display.length;
    } else if (isCurrentFileAnchor(parsed.path, parsed.anchor) && parsed.anchor) {
      // `[[#Heading]]` / `[[^block]]`: hide the marker with the brackets so the
      // collapsed chip reads as the heading / id, not `#Heading`.
      display = parsed.anchor.value;
      const leading = rawTarget.length - rawTarget.trimStart().length;
      displayFrom = from + 2 + leading + 1;
      displayTo = displayFrom + display.length;
    } else {
      display = target;
      const leading = rawTarget.length - rawTarget.trimStart().length;
      displayFrom = from + 2 + leading;
      displayTo = displayFrom + display.length;
    }

    out.push({
      from,
      to,
      target,
      path: parsed.path,
      anchor: parsed.anchor,
      alias,
      display,
      displayFrom,
      displayTo,
    });
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

function linkIsUnresolved(
  match: WikiLinkMatch,
  resolve: WikilinksOptions["resolve"]
): boolean {
  if (!resolve) return false;
  if (isCurrentFileAnchor(match.path, match.anchor)) return false;
  return !resolve(match.target);
}

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
    const unresolved = linkIsUnresolved(m, resolve);
    const style = unresolved ? UNRESOLVED_STYLE : RESOLVED_STYLE;
    const attrs: Record<string, string> = {
      style,
      "data-wikilink-target": m.target,
    };
    if (unresolved) attrs["data-wikilink-unresolved"] = "true";
    if (m.alias) attrs["data-wikilink-alias"] = m.alias;
    if (m.path) attrs["data-wikilink-path"] = m.path;
    if (m.anchor) {
      attrs["data-wikilink-anchor-kind"] = m.anchor.kind;
      attrs["data-wikilink-anchor"] = m.anchor.value;
    }

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

function splitTypingQuery(query: string): Pick<WikiLinkTypingContext, "path" | "anchor"> {
  const hash = query.indexOf("#");
  const caret = query.indexOf("^");
  if (hash < 0 && caret < 0) return { path: query, anchor: null };

  const headingFirst = hash >= 0 && (caret < 0 || hash < caret);
  const markerIndex = headingFirst ? hash : caret;
  return {
    path: query.slice(0, markerIndex),
    anchor: {
      kind: headingFirst ? "heading" : "block",
      query: query.slice(markerIndex + 1),
      markerIndex,
    },
  };
}

/**
 * Locate an open `[[…` at `pos` (the closing `]]` has not been typed yet, or
 * the cursor is still inside the target). Pure helper for hosts and tests.
 */
export function getWikiLinkTypingContext(doc: string, pos: number): WikiLinkTypingContext | null {
  const { start } = lineBoundaries(doc, pos);
  const line = doc.slice(start, pos);
  const openIdx = line.lastIndexOf("[[");
  if (openIdx < 0) return null;
  if (openIdx > 0 && line[openIdx - 1] === "\\") return null;
  const between = line.slice(openIdx + 2);
  if (between.includes("]]")) return null;
  if (between.includes("\n")) return null;
  const query = between.split("|")[0];
  const split = splitTypingQuery(query);
  return { openFrom: start + openIdx, query, path: split.path, anchor: split.anchor };
}

function filterCandidates(candidates: readonly string[], query: string): string[] {
  const queryLower = query.toLowerCase();
  const filtered = queryLower
    ? candidates.filter((candidate) => candidate.toLowerCase().includes(queryLower))
    : [...candidates];
  return filtered.slice(0, 50);
}

function applyWikiCompletion(view: EditorView, from: number, to: number, text: string): void {
  const after = view.state.doc.sliceString(to, Math.min(to + 2, view.state.doc.length));
  const needsClose = after !== "]]";
  const insert = needsClose ? `${text}]]` : text;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
  });
}

function createAutocompleteSource(
  suggest: WikilinksOptions["suggest"],
  suggestAnchors: WikilinksOptions["suggestAnchors"]
) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const pos = ctx.pos;
    const doc = ctx.state.doc.toString();
    const wk = getWikiLinkTypingContext(doc, pos);
    if (!wk) return null;

    if (wk.anchor && suggestAnchors) {
      const candidates = await Promise.resolve(
        suggestAnchors({
          path: wk.path,
          kind: wk.anchor.kind,
          query: wk.anchor.query,
        })
      );
      if (!candidates || candidates.length === 0) return null;
      const filtered = filterCandidates(candidates, wk.anchor.query);
      if (filtered.length === 0) return null;

      const options: Completion[] = filtered.map((name) => ({
        label: name,
        type: "text",
        apply(view, _completion, from, to) {
          applyWikiCompletion(view, from, to, name);
        },
      }));

      return {
        from: wk.openFrom + 2 + wk.anchor.markerIndex + 1,
        to: pos,
        options,
        validFor: /^[^\[\]\n|^]*$/,
      };
    }

    if (!suggest) return null;
    const candidates = await Promise.resolve(suggest(wk.query));
    if (!candidates || candidates.length === 0) return null;
    const filtered = filterCandidates(candidates, wk.query);
    if (filtered.length === 0) return null;

    const options: Completion[] = filtered.map((name) => ({
      label: name,
      type: "text",
      apply(view, _completion, from, to) {
        applyWikiCompletion(view, from, to, name);
      },
    }));

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

  const compositionHandler = EditorView.domEventHandlers({
    compositionend(_event, view) {
      setTimeout(() => {
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
      const parsed = parseWikiLinkTarget(target);
      event.preventDefault();
      event.stopPropagation();
      onNavigate(target, {
        unresolved,
        path: parsed.path,
        anchor: parsed.anchor,
      });
      return true;
    },
  });

  const exts: Extension[] = [field, compositionHandler, clickHandler];

  if (options.suggest || options.suggestAnchors) {
    exts.push(
      autocompletion({
        override: [createAutocompleteSource(options.suggest, options.suggestAnchors)],
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
