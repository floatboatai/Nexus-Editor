import { ensureSyntaxTree, language } from "@codemirror/language";
import { EditorSelection, type ChangeSet, type EditorState } from "@codemirror/state";

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

const MOVABLE = /^(Paragraph|ATXHeading[1-6]|SetextHeading[12]|BulletList|OrderedList|Blockquote|FencedCode|CodeBlock|Table|HorizontalRule)$/;

export function readBlocks(state: EditorState): MarkdownBlock[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 100);
  if (!tree) return [];
  const blocks: MarkdownBlock[] = [];
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    blocks.push({
      from: state.doc.lineAt(node.from).from,
      to: state.doc.lineAt(node.to).to,
      type: node.name,
      movable: MOVABLE.test(node.name),
    });
  }
  return blocks;
}

/** Target is a gap index: 0 is before the first block, length is the document end. */
export function planBlockMove(
  state: EditorState,
  blocks: readonly MarkdownBlock[],
  sourceIndex: number,
  target: number,
): BlockMove | null {
  if (sourceIndex < 0 || sourceIndex >= blocks.length || target < 0 || target > blocks.length) return null;
  if (!blocks[sourceIndex].movable || target === sourceIndex || target === sourceIndex + 1) return null;

  const source = state.doc.toString();
  const order = blocks.map((_, index) => index);
  order.splice(sourceIndex, 1);
  order.splice(target > sourceIndex ? target - 1 : target, 0, sourceIndex);

  const positions = new Map<number, number>();
  let next = source.slice(0, blocks[0].from);
  for (let i = 0; i < order.length; i++) {
    const index = order[i];
    const block = blocks[index];
    if (i > 0) {
      const previous = order[i - 1];
      next += previous + 1 === index
        ? source.slice(blocks[previous].to, block.from)
        : "\n\n";
    }
    positions.set(index, next.length);
    next += source.slice(block.from, block.to);
  }
  next += source.slice(blocks[blocks.length - 1].to);
  if (next === source) return null;

  // Reparse with this editor's language (including its Markdown extensions).
  // Both the insertion and removal boundaries can merge or reinterpret blocks.
  const tree = state.facet(language)!.parser.parse(next);
  let index = 0;
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (index === order.length) return null;
    const expected = blocks[order[index++]];
    if (node.name !== expected.type ||
        next.slice(node.from, node.to).trim() !== source.slice(expected.from, expected.to).trim()) return null;
  }
  if (index !== order.length) return null;

  // Replace only the changed interval. Every selection endpoint inside a block
  // is mapped by that block's identity in this permutation, not by deletion bias.
  let from = 0;
  while (from < source.length && from < next.length && source[from] === next[from]) from++;
  let oldEnd = source.length;
  let newEnd = next.length;
  while (oldEnd > from && newEnd > from && source[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const changes = state.changes({ from, to: oldEnd, insert: next.slice(from, newEnd) });
  const mapPosition = (pos: number): number => {
    const index = blocks.findIndex((block) => pos >= block.from && pos <= block.to);
    return index < 0 ? changes.mapPos(pos) : positions.get(index)! + pos - blocks[index].from;
  };
  const selection = EditorSelection.create(state.selection.ranges.map((range) =>
    EditorSelection.range(mapPosition(range.anchor), mapPosition(range.head)),
  ), state.selection.mainIndex);
  return { changes, selection, movedFrom: positions.get(sourceIndex)! };
}
