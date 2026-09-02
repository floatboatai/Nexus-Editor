import { DocInput, ensureSyntaxTree, language, syntaxTree } from "@codemirror/language";
import {
  ChangeSet,
  type ChangeSpec,
  countColumn,
  type EditorSelection,
  type EditorState,
  type Line,
  type Text,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { type SyntaxNode, type Tree, TreeFragment } from "@lezer/common";

import { directChildren, findChildByName, iterateInRange } from "./lezer-helpers";

const ORDERED_MARK_RE = /^(\d{1,9})[.)]$/;
/** CommonMark caps ordered-list markers at nine digits; a wider marker stops being a list item. */
const MAX_ORDERED_NUMBER = 999_999_999;
const QUOTE_MARKER_RE = /^ {0,3}>[ \t]?/;
const LEADING_WHITESPACE_RE = /^[ \t]*/;
const SYNTAX_TREE_TIMEOUT_MS = 50;
const LIST_CONTAINER_NODES = new Set(["Document", "BulletList", "OrderedList", "ListItem", "Blockquote"]);

/** The document a command reads plus the tab size its columns are measured in. */
interface ListDocument {
  doc: Text;
  tabSize: number;
}

interface ListItemInfo {
  node: SyntaxNode;
  quoteDepth: number;
  firstLine: Line;
  lastLine: Line;
  /** Column of the list marker, measured from the end of the blockquote prefix. */
  indent: number;
  /** Column where the item's content starts — the indent a nested list needs. */
  contentCol: number;
  /** Document position where the item's text starts on its marker line, after any task box. */
  textFrom: number;
}

interface LineShift {
  delta: number;
  quoteDepth: number;
}

interface ListShiftPlan {
  shifts: Map<number, LineShift>;
  /** Marker positions (pre-edit) of items whose parent list changes. */
  resetPositions: number[];
}

interface ListRenumberPlan {
  /** Line numbers used to locate the lists that need renumbering. */
  anchorLines: Set<number>;
  /**
   * Line numbers of items whose parent list changed. A list that starts on
   * one of these lines restarts at 1 instead of keeping its written number.
   */
  resetLines: Set<number>;
}

/**
 * The freshest tree available. `syntaxTree` only reflects the last
 * transaction, so a document still being parsed in the background is given a
 * short budget to finish; the parse context keeps whatever progress it made,
 * so a command that falls back to the partial tree once succeeds on the next
 * keypress.
 */
function resolveTree(state: EditorState): Tree {
  return ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_TIMEOUT_MS) ?? syntaxTree(state);
}

function listDocument(state: EditorState): ListDocument {
  return { doc: state.doc, tabSize: state.tabSize };
}

/**
 * Parse the document as it will look after `changes`, reusing `tree`
 * incrementally. Runs the parser directly instead of staging an EditorState
 * so no StateField (live preview, wiki links) rebuilds twice. Returns null
 * when the state has no Markdown language installed.
 */
function parseAfter(state: EditorState, tree: Tree, changes: ChangeSet): { doc: Text; tree: Tree } | null {
  const parser = state.facet(language)?.parser;
  if (!parser) return null;

  const doc = changes.apply(state.doc);
  const ranges: { fromA: number; toA: number; fromB: number; toB: number }[] = [];
  changes.iterChangedRanges((fromA, toA, fromB, toB) => ranges.push({ fromA, toA, fromB, toB }));
  const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), ranges);
  return { doc, tree: parser.parse(new DocInput(doc), fragments) };
}

function quoteDepth(node: SyntaxNode): number {
  let depth = 0;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "Blockquote") depth++;
  }
  return depth;
}

/**
 * Length of the `> ` prefixes that a line inside `depth` nested blockquotes
 * carries, or null when the line is a lazy continuation without them.
 */
function quotePrefixLength(text: string, depth: number): number | null {
  let offset = 0;
  for (let i = 0; i < depth; i++) {
    const match = QUOTE_MARKER_RE.exec(text.slice(offset));
    if (!match) return null;
    offset += match[0].length;
  }
  return offset;
}

function listItemInfo({ doc, tabSize }: ListDocument, node: SyntaxNode): ListItemInfo {
  const firstLine = doc.lineAt(node.from);
  const depth = quoteDepth(node);
  const prefix = quotePrefixLength(firstLine.text, depth) ?? 0;

  // A top-level ListItem starts at its leading whitespace while a nested one
  // starts at the marker, so the marker is the only reliable column source.
  const mark = findChildByName(node, "ListMark");
  const markFrom = mark ? mark.from : node.from;
  let contentFrom = (mark ? mark.to : node.from) + 1;
  let child = mark ? mark.nextSibling : null;
  while (child && child.name === "QuoteMark") child = child.nextSibling;
  if (child && child.from <= firstLine.to) contentFrom = child.from;
  contentFrom = Math.min(contentFrom, firstLine.to);

  // A task box is part of the item's paragraph, so nesting still keys off
  // the column after the marker while the item's own text begins after the box.
  const taskMarker = child?.name === "Task" ? findChildByName(child, "TaskMarker") : null;

  const base = countColumn(firstLine.text, tabSize, prefix);
  const column = (pos: number): number => countColumn(firstLine.text, tabSize, pos - firstLine.from) - base;
  return {
    node,
    quoteDepth: depth,
    firstLine,
    lastLine: doc.lineAt(node.to),
    indent: column(markFrom),
    contentCol: column(contentFrom),
    textFrom: taskMarker ? Math.min(taskMarker.to + 1, firstLine.to) : contentFrom,
  };
}

/** The innermost ListItem around `pos`, or null. */
function listItemAt(tree: Tree, pos: number): SyntaxNode | null {
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node && node.name !== "ListItem") node = node.parent;
  return node;
}

function previousSibling(node: SyntaxNode): SyntaxNode | null {
  let sibling = node.prevSibling;
  while (sibling && sibling.name !== "ListItem") sibling = sibling.prevSibling;
  return sibling;
}

function nextSibling(node: SyntaxNode): SyntaxNode | null {
  let sibling = node.nextSibling;
  while (sibling && sibling.name !== "ListItem") sibling = sibling.nextSibling;
  return sibling;
}

function parentItem(node: SyntaxNode): SyntaxNode | null {
  const parent = node.parent?.parent;
  return parent && parent.name === "ListItem" ? parent : null;
}

/** An ordered item's marker node and written digits, or null for a bullet. */
function readOrderedMark(doc: Text, item: SyntaxNode): { mark: SyntaxNode; digits: string } | null {
  const mark = findChildByName(item, "ListMark");
  const match = mark ? ORDERED_MARK_RE.exec(doc.sliceString(mark.from, mark.to)) : null;
  return mark && match ? { mark, digits: match[1] } : null;
}

/**
 * The column an item moves to when indented: the content column of its
 * previous sibling, or — when the item opens a list on the very next line
 * after another list (`1. a` followed by `- b`) — of that list's last item.
 * A blank line between the lists means the author separated them on
 * purpose. Null when there is nothing to nest under.
 */
function indentTarget(ctx: ListDocument, item: ListItemInfo): number | null {
  let anchor = previousSibling(item.node);
  if (!anchor) {
    const previousList = item.node.parent?.prevSibling;
    const adjacent =
      previousList &&
      (previousList.name === "BulletList" || previousList.name === "OrderedList") &&
      ctx.doc.lineAt(previousList.to).number === item.firstLine.number - 1;
    anchor = adjacent && previousList.lastChild?.name === "ListItem" ? previousList.lastChild : null;
  }
  return anchor ? listItemInfo(ctx, anchor).contentCol : null;
}

/** The column an item moves to when outdented: its parent's indent, or 0 at the top level. */
function outdentTarget(ctx: ListDocument, item: ListItemInfo): number {
  const parent = parentItem(item.node);
  return parent ? listItemInfo(ctx, parent).indent : 0;
}

function hasSelectedAncestor(node: SyntaxNode, selected: Map<number, SyntaxNode>): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.name === "ListItem" && selected.has(parent.from)) return true;
  }
  return false;
}

/**
 * List items whose marker line is touched by a selection range, in document
 * order. Items nested inside another selected item are dropped — they move
 * with their ancestor.
 */
function selectedListItems(ctx: ListDocument, tree: Tree, selection: EditorSelection): ListItemInfo[] {
  const { doc } = ctx;
  const selected = new Map<number, SyntaxNode>();

  for (const range of selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const lastLine = doc.lineAt(range.to);
    const last = !range.empty && range.to === lastLine.from ? lastLine.number - 1 : lastLine.number;
    if (last < first) continue;

    iterateInRange(tree, doc.line(first).from, doc.line(last).to, ({ name, node }) => {
      if (!LIST_CONTAINER_NODES.has(name)) return false;
      if (name !== "ListItem" || !node) return;
      const markerLine = doc.lineAt(node.from).number;
      if (markerLine >= first && markerLine <= last) selected.set(node.from, node);
    });
  }

  return [...selected.values()]
    .filter((node) => !hasSelectedAncestor(node, selected))
    .sort((a, b) => a.from - b.from)
    .map((node) => listItemInfo(ctx, node));
}

/** Split items into runs of consecutive siblings so a run shifts as one unit. */
function groupConsecutiveSiblings(items: ListItemInfo[]): ListItemInfo[][] {
  const groups: ListItemInfo[][] = [];
  for (const item of items) {
    const group = groups[groups.length - 1];
    const last = group?.[group.length - 1];
    if (group && last && previousSibling(item.node)?.from === last.node.from) {
      group.push(item);
    } else {
      groups.push([item]);
    }
  }
  return groups;
}

/**
 * Assign one indentation delta to a block of lines. Later assignments win:
 * when a selected item sits among the followers of an earlier outdented
 * item, its own move replaces the follower alignment, which is what applying
 * the commands one after another would produce.
 */
function setLineShift(shifts: Map<number, LineShift>, from: number, to: number, delta: number, depth: number): void {
  for (let number = from; number <= to; number++) shifts.set(number, { delta, quoteDepth: depth });
}

/** Accumulate a delta: nested marker-width changes stack on their ancestors' shifts. */
function addLineShift(shifts: Map<number, LineShift>, from: number, to: number, delta: number, depth: number): void {
  for (let number = from; number <= to; number++) {
    const existing = shifts.get(number);
    shifts.set(number, { delta: (existing?.delta ?? 0) + delta, quoteDepth: depth });
  }
}

/**
 * Move a run of sibling items to `column`, children and continuation lines
 * included. With `reparentFollowers`, the siblings after the run become
 * children of its last item, aligned to that item's new content column.
 */
function planShift(
  ctx: ListDocument,
  group: ListItemInfo[],
  column: number,
  reparentFollowers: boolean,
  plan: ListShiftPlan,
): void {
  const first = group[0];
  const last = group[group.length - 1];
  const delta = column - first.indent;
  if (delta === 0) return;

  setLineShift(plan.shifts, first.firstLine.number, last.lastLine.number, delta, first.quoteDepth);
  for (const item of group) plan.resetPositions.push(item.node.from);

  const follower = reparentFollowers ? nextSibling(last.node) : null;
  if (!follower || !last.node.parent) return;
  const followerInfo = listItemInfo(ctx, follower);
  setLineShift(
    plan.shifts,
    followerInfo.firstLine.number,
    ctx.doc.lineAt(last.node.parent.to).number,
    last.contentCol + delta - followerInfo.indent,
    first.quoteDepth,
  );
  plan.resetPositions.push(follower.from);
}

/**
 * Turn per-line indentation deltas into edits. Blank lines stay blank and
 * lazy continuation lines (missing their `>` prefix) are left alone. A
 * negative delta never removes more indentation than the line has. Tab
 * indentation is measured in columns and rewritten as spaces on the lines
 * the command touches.
 */
function lineShiftChanges({ doc, tabSize }: ListDocument, shifts: Map<number, LineShift>): ChangeSpec[] {
  const specs: ChangeSpec[] = [];
  for (const [number, { delta, quoteDepth: depth }] of shifts) {
    if (delta === 0 || number < 1 || number > doc.lines) continue;
    const line = doc.line(number);
    const prefix = quotePrefixLength(line.text, depth);
    if (prefix === null) continue;
    const rest = line.text.slice(prefix);
    if (rest.trim() === "") continue;

    const from = line.from + prefix;
    const whitespace = LEADING_WHITESPACE_RE.exec(rest)?.[0] ?? "";
    if (whitespace.includes("\t")) {
      const width = countColumn(line.text, tabSize, prefix + whitespace.length) - countColumn(line.text, tabSize, prefix);
      specs.push({ from, to: from + whitespace.length, insert: " ".repeat(Math.max(0, width + delta)) });
    } else if (delta > 0) {
      specs.push({ from, insert: " ".repeat(delta) });
    } else {
      const remove = Math.min(whitespace.length, -delta);
      if (remove > 0) specs.push({ from, to: from + remove });
    }
  }
  return specs;
}

function outermostList(node: SyntaxNode | null): SyntaxNode | null {
  let list: SyntaxNode | null = null;
  for (let current = node; current; current = current.parent) {
    if (current.name === "BulletList" || current.name === "OrderedList") list = current;
  }
  return list;
}

/**
 * Replace an ordered marker's digits. A wider or narrower marker moves the
 * item's content column, so every continuation line has to follow or nested
 * lists fall out of the item.
 */
function writeMarkerNumber(
  doc: Text,
  item: SyntaxNode,
  mark: SyntaxNode,
  writtenDigits: string,
  number: number,
  specs: ChangeSpec[],
  shifts: Map<number, LineShift>,
): void {
  const digits = String(number);
  specs.push({ from: mark.from, to: mark.from + writtenDigits.length, insert: digits });

  const widthDelta = digits.length - writtenDigits.length;
  const firstLine = doc.lineAt(item.from).number;
  const lastLine = doc.lineAt(item.to).number;
  if (widthDelta !== 0 && lastLine > firstLine) {
    addLineShift(shifts, firstLine + 1, lastLine, widthDelta, quoteDepth(item));
  }
}

function renumberList(
  doc: Text,
  list: SyntaxNode,
  resetLines: Set<number>,
  specs: ChangeSpec[],
  shifts: Map<number, LineShift>,
): void {
  let expected = 1;
  let index = 0;

  for (const item of directChildren(list)) {
    const ordered = item.name === "ListItem" ? readOrderedMark(doc, item) : null;
    if (!ordered) continue;

    const written = Number(ordered.digits);
    const number = index === 0 ? (resetLines.has(doc.lineAt(item.from).number) ? 1 : written) : expected;
    if (number > MAX_ORDERED_NUMBER) return;
    expected = number + 1;
    index++;
    if (number !== written) writeMarkerNumber(doc, item, ordered.mark, ordered.digits, number, specs, shifts);
  }
}

/**
 * Changes that make every ordered list reachable from `plan.anchorLines`
 * count consecutively again. Nested lists inside the located lists are
 * renumbered too, so one anchor per edit site is enough.
 */
function renumberChanges(ctx: ListDocument, tree: Tree, plan: ListRenumberPlan): ChangeSpec[] {
  const { doc } = ctx;
  const roots = new Map<number, SyntaxNode>();
  for (const number of plan.anchorLines) {
    if (number < 1 || number > doc.lines) continue;
    const root = outermostList(tree.resolveInner(doc.line(number).from, 1));
    if (root) roots.set(root.from, root);
  }

  const specs: ChangeSpec[] = [];
  const shifts = new Map<number, LineShift>();
  for (const root of roots.values()) {
    iterateInRange(tree, root.from, root.to, ({ name, node, from, to }) => {
      if (!LIST_CONTAINER_NODES.has(name)) return false;
      if (name === "OrderedList" && node && from >= root.from && to <= root.to) {
        renumberList(doc, node, plan.resetLines, specs, shifts);
      }
    });
  }

  specs.push(...lineShiftChanges(ctx, shifts));
  return specs;
}

/** Line numbers of `positions` plus `radius` lines on either side. */
function lineSet(doc: Text, positions: Iterable<number>, radius: number): Set<number> {
  const lines = new Set<number>();
  for (const pos of positions) {
    const number = doc.lineAt(pos).number;
    for (let n = number - radius; n <= number + radius; n++) lines.add(n);
  }
  return lines;
}

/**
 * Dispatch `changes` together with the renumbering they call for as one
 * transaction, so undo restores the document in a single step. `plan` reads
 * the post-edit document to decide which lists to renumber.
 */
function dispatchWithRenumber(
  view: EditorView,
  tree: Tree,
  changes: ChangeSet,
  selection: EditorSelection,
  userEvent: string,
  plan: (doc: Text) => ListRenumberPlan,
): void {
  const parsed = parseAfter(view.state, tree, changes);
  const renumber = parsed
    ? ChangeSet.of(
        renumberChanges({ doc: parsed.doc, tabSize: view.state.tabSize }, parsed.tree, plan(parsed.doc)),
        parsed.doc.length,
      )
    : ChangeSet.empty(changes.newLength);
  view.dispatch({
    changes: changes.compose(renumber),
    selection: selection.map(renumber),
    userEvent,
    scrollIntoView: true,
  });
}

/**
 * Dispatch a transaction built by another command (currently the Enter
 * continuation) with the renumbering pass appended. Lists are located from
 * the lines the new selection heads land on plus their neighbours, so an
 * item that was just emptied still finds the list it belongs to.
 */
export function dispatchListTransaction(
  view: EditorView,
  spec: { changes: ChangeSet; selection: EditorSelection },
): void {
  const heads = spec.selection.ranges.map((range) => range.head);
  dispatchWithRenumber(view, resolveTree(view.state), spec.changes, spec.selection, "input", (doc) => ({
    anchorLines: lineSet(doc, heads, 1),
    resetLines: new Set(),
  }));
}

/**
 * Shared driver for indent and outdent: collect the selected items, move
 * each run of siblings to the column `target` picks, then dispatch the moves
 * plus renumbering. Returns false when no selection range touches a list
 * item's marker line, so the key falls through to plain indentation; an item
 * that cannot move still consumes the key.
 */
function shiftListItems(
  view: EditorView,
  userEvent: string,
  target: (ctx: ListDocument, item: ListItemInfo) => number | null,
  reparentFollowers: boolean,
): boolean {
  const { state } = view;
  if (state.readOnly) return false;

  const ctx = listDocument(state);
  const tree = resolveTree(state);
  const items = selectedListItems(ctx, tree, state.selection);
  if (items.length === 0) return false;

  const plan: ListShiftPlan = { shifts: new Map(), resetPositions: [] };
  for (const group of groupConsecutiveSiblings(items)) {
    const column = target(ctx, group[0]);
    if (column !== null) planShift(ctx, group, column, reparentFollowers, plan);
  }

  const specs = lineShiftChanges(ctx, plan.shifts);
  if (specs.length === 0) return true;

  const changes = state.changes(specs);
  dispatchWithRenumber(view, tree, changes, state.selection.map(changes), userEvent, (doc) => {
    const resetLines = lineSet(doc, plan.resetPositions.map((pos) => changes.mapPos(pos, 1)), 0);
    return { anchorLines: new Set(resetLines), resetLines };
  });
  return true;
}

/**
 * Nest the list items under the selection beneath their previous sibling,
 * indenting to that sibling's content column (`1. ` needs three spaces,
 * `10. ` four — CommonMark, not a fixed indent unit). Children travel with
 * the item and ordered lists are renumbered. Returns false when no selection
 * range touches a list item line; the first item of a list has nothing to
 * nest under and is left unchanged.
 */
export function indentListItem(view: EditorView): boolean {
  return shiftListItems(view, "input.indent", indentTarget, false);
}

/**
 * Lift the list items under the selection to their parent's level. Siblings
 * that followed the item become its children (their indentation is aligned
 * to the item's new content column), children travel with the item, and
 * ordered lists are renumbered. Top-level items only lose stray indentation;
 * non-list lines return false.
 */
export function outdentListItem(view: EditorView): boolean {
  return shiftListItems(view, "delete.dedent", outdentTarget, true);
}

/**
 * Backspace with every cursor at the start of a list item's content: a
 * nested item is outdented (as with Shift-Tab); a top-level item loses its
 * indentation, marker and task box and becomes plain text, its nested lines
 * moving left by the same amount. Any cursor elsewhere, or a non-empty
 * selection, returns false so the default deletion applies.
 */
export function backspaceListItem(view: EditorView): boolean {
  const { state } = view;
  if (state.readOnly) return false;

  const ctx = listDocument(state);
  const { doc } = ctx;
  const tree = resolveTree(state);
  const items = new Map<number, ListItemInfo>();
  for (const range of state.selection.ranges) {
    if (!range.empty) return false;
    const node = listItemAt(tree, range.head);
    const info = node ? listItemInfo(ctx, node) : null;
    if (!node || !info || info.textFrom !== range.head) return false;
    items.set(node.from, info);
  }

  const plan: ListShiftPlan = { shifts: new Map(), resetPositions: [] };
  const specs: ChangeSpec[] = [];
  const unlisted: number[] = [];
  for (const info of [...items.values()].sort((a, b) => a.node.from - b.node.from)) {
    if (parentItem(info.node)) {
      planShift(ctx, [info], outdentTarget(ctx, info), true, plan);
      continue;
    }

    const prefix = quotePrefixLength(info.firstLine.text, info.quoteDepth) ?? 0;
    specs.push({ from: info.firstLine.from + prefix, to: info.textFrom });
    if (info.lastLine.number > info.firstLine.number) {
      setLineShift(plan.shifts, info.firstLine.number + 1, info.lastLine.number, -info.contentCol, info.quoteDepth);
    }
    unlisted.push(info.firstLine.from);

    // The next sibling now opens a new list. An ordered list can only
    // interrupt the paragraph this item just became if it starts at 1, so
    // the restart has to be written here rather than left to renumbering.
    const follower = nextSibling(info.node);
    const ordered = follower ? readOrderedMark(doc, follower) : null;
    if (follower && ordered && ordered.digits !== "1") {
      writeMarkerNumber(doc, follower, ordered.mark, ordered.digits, 1, specs, plan.shifts);
    }
  }

  specs.push(...lineShiftChanges(ctx, plan.shifts));
  const changes = state.changes(specs);
  dispatchWithRenumber(view, tree, changes, state.selection.map(changes), "delete.backward", (newDoc) => {
    const resetLines = lineSet(newDoc, plan.resetPositions.map((pos) => changes.mapPos(pos, 1)), 0);
    const anchorLines = lineSet(newDoc, unlisted.map((pos) => changes.mapPos(pos, 1)), 1);
    for (const line of resetLines) anchorLines.add(line);
    return { anchorLines, resetLines };
  });
  return true;
}
