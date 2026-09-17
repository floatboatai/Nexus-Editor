import { DocInput, ensureSyntaxTree, language } from "@codemirror/language";
import { ChangeSet, EditorSelection, type EditorState, type Text } from "@codemirror/state";
import { IterMode, type SyntaxNode, type Tree } from "@lezer/common";

export interface MarkdownBlock {
  readonly from: number;
  readonly to: number;
  readonly type: string;
  readonly movable: boolean;
}

export interface BlockMove {
  readonly changes: ChangeSet;
  readonly selection: EditorSelection;
  readonly movedFrom: number;
}

interface BlockSnapshot {
  blocks: readonly MarkdownBlock[];
  nodes: readonly SyntaxNode[];
  signatures?: readonly string[];
}

const snapshots = new WeakMap<EditorState, BlockSnapshot>();
const movableTypes = new Set([
  "Paragraph", "Blockquote", "BulletList", "OrderedList", "FencedCode",
  "CodeBlock", "IndentedCode", "Table", "HorizontalRule",
  "ATXHeading1", "ATXHeading2", "ATXHeading3", "ATXHeading4", "ATXHeading5", "ATXHeading6",
  "SetextHeading1", "SetextHeading2"
]);

function snapshotTree(tree: Tree, doc: Text): BlockSnapshot {
  const blocks: MarkdownBlock[] = [];
  const nodes: SyntaxNode[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    nodes.push(node);
    blocks.push({
      from: doc.lineAt(node.from).from,
      to: doc.lineAt(node.to).to,
      type: node.name,
      movable: movableTypes.has(node.name)
    });
  }
  return { blocks, nodes };
}

function readSnapshot(state: EditorState): BlockSnapshot | null {
  const cached = snapshots.get(state);
  if (cached) return cached;
  // Never offer a partial block from the viewport's unfinished parse.
  const tree = ensureSyntaxTree(state, state.doc.length, 25);
  if (!tree || tree.topNode.name !== "Document") return null;
  const snapshot = snapshotTree(tree, state.doc);
  if (snapshot.blocks.some((block, index) => index > 0 && block.from < snapshot.blocks[index - 1].to)) {
    return null;
  }
  snapshots.set(state, snapshot);
  return snapshot;
}

/** Outermost Markdown blocks, including immovable definitions and custom nodes. */
export function readBlocks(state: EditorState): readonly MarkdownBlock[] {
  return readSnapshot(state)?.blocks ?? [];
}

function signature(node: SyntaxNode, from: number): string {
  const cursor = node.cursor(IterMode.IgnoreMounts);
  const parts: string[] = [];
  cursor.iterate(
    child => { parts.push(`(${child.name}:${child.from - from}:${child.to - from}`); },
    () => { parts.push(")"); }
  );
  return parts.join(";");
}

function preservesBlocks(
  state: EditorState,
  snapshot: BlockSnapshot,
  order: readonly number[],
  changes: ChangeSet,
  deadline: number
): boolean {
  const parser = state.facet(language)?.parser;
  if (!parser) return false;
  const doc = changes.apply(state.doc);
  const parse = parser.startParse(new DocInput(doc));
  let tree: Tree | null;
  do {
    tree = parse.advance();
    if (!tree && Date.now() >= deadline) return false;
  } while (!tree);
  const next = snapshotTree(tree, doc);
  if (next.blocks.length !== order.length) return false;
  snapshot.signatures ??= snapshot.nodes.map((node, index) =>
    signature(node, snapshot.blocks[index].from)
  );
  return order.every((oldIndex, newIndex) => {
    const before = snapshot.blocks[oldIndex];
    const after = next.blocks[newIndex];
    return state.doc.sliceString(before.from, before.to) === doc.sliceString(after.from, after.to)
      && snapshot.signatures![oldIndex] === signature(next.nodes[newIndex], after.from);
  });
}

function blankLinePadding(separator: string): string {
  let newlines = 0;
  for (const char of separator) {
    if (char === "\n") newlines++;
  }
  return "\n".repeat(Math.max(0, 2 - newlines));
}

/**
 * Plan one atomic move to a gap in the original block list (0 through length).
 * Preserve source text verbatim; add blank lines only if the original separators
 * would change Markdown structure. A move that still changes any subtree fails.
 */
export function planBlockMove(
  state: EditorState,
  blocks: readonly MarkdownBlock[],
  sourceIndex: number,
  targetGapIndex: number
): BlockMove | null {
  if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetGapIndex)
    || sourceIndex < 0 || sourceIndex >= blocks.length
    || targetGapIndex < 0 || targetGapIndex > blocks.length
    || targetGapIndex === sourceIndex || targetGapIndex === sourceIndex + 1) return null;
  const snapshot = readSnapshot(state);
  if (!snapshot || snapshot.blocks.length !== blocks.length
    || blocks.some((block, index) => {
      const current = snapshot.blocks[index];
      return block.from !== current.from || block.to !== current.to
        || block.type !== current.type || block.movable !== current.movable;
    })) return null;
  const source = blocks[sourceIndex];
  if (!source.movable) return null;
  const beforeSource = blocks[sourceIndex - 1];
  const afterSource = blocks[sourceIndex + 1];
  const removeFrom = afterSource ? source.from : beforeSource.to;
  const removeTo = afterSource ? afterSource.from : source.to;
  const separator = afterSource
    ? state.doc.sliceString(source.to, afterSource.from)
    : state.doc.sliceString(beforeSource.to, source.from);
  const right = blocks[targetGapIndex];
  const left = blocks[targetGapIndex - 1];
  const insertAt = right ? right.from : left.to;
  const raw = state.doc.sliceString(source.from, source.to);
  const order = blocks.map((_, index) => index).filter(index => index !== sourceIndex);
  order.splice(targetGapIndex > sourceIndex ? targetGapIndex - 1 : targetGapIndex, 0, sourceIndex);

  const padding = [
    beforeSource && afterSource ? blankLinePadding(state.doc.sliceString(beforeSource.to, source.from)) : "",
    left && right ? blankLinePadding(state.doc.sliceString(left.to, right.from)) : "",
    blankLinePadding(separator)
  ];
  const availablePadding = padding.reduce((mask, value, index) => value ? mask | (1 << index) : mask, 0);
  const deadline = Date.now() + 50;
  // Try the fewest boundary changes first, within one shared parse budget.
  for (const mask of [0, 1, 2, 4, 3, 5, 6, 7]) {
    if ((mask & availablePadding) !== mask) continue;
    if (Date.now() >= deadline) return null;
    const removalPadding = mask & 1 ? padding[0] : "";
    const leadingPadding = mask & 2 ? padding[1] : "";
    const separatorPadding = mask & 4 ? padding[2] : "";
    const prefix = right ? leadingPadding : separator + separatorPadding;
    const insert = right ? prefix + raw + separator + separatorPadding : prefix + raw;
    const changes = ChangeSet.of([
      { from: removeFrom, to: removeTo, insert: removalPadding },
      { from: insertAt, insert }
    ], state.doc.length);
    if (!preservesBlocks(state, snapshot, order, changes, deadline)) continue;
    const movedFrom = changes.mapPos(insertAt, -1) + prefix.length;
    const mapPosition = (position: number, assoc: number): number =>
      position >= source.from && position <= source.to
        ? movedFrom + position - source.from
        : changes.mapPos(position, position === insertAt ? (right ? 1 : -1) : assoc);
    const selection = EditorSelection.create(state.selection.ranges.map(range =>
      EditorSelection.range(
        mapPosition(range.anchor, range.assoc),
        mapPosition(range.head, range.assoc),
        range.goalColumn,
        range.bidiLevel ?? undefined,
        range.assoc
      )
    ), state.selection.mainIndex);
    return { changes, selection, movedFrom };
  }
  return null;
}
