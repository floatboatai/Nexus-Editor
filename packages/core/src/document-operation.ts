import type { Root } from "mdast";

export interface DocumentNode {
  id: string;
  type: string;
  value?: string;
  children?: DocumentNode[];
}

export type DocumentNodeContent = string | {
  type: string;
  value?: string;
  depth?: number;
  children?: DocumentNodeContent[];
};

export interface ReplacePatch {
  type: "replace";
  nodeId: string;
  content: DocumentNodeContent;
}

export interface InsertPatch {
  type: "insert";
  parentId: string;
  position: "before" | "after" | "first" | "last";
  content: DocumentNodeContent;
  referenceId?: string;
}

export interface DeletePatch {
  type: "delete";
  nodeId: string;
}

export type DocumentPatch = ReplacePatch | InsertPatch | DeletePatch;

export interface DocumentManager {
  getTree(): DocumentNode;
  findNode(nodeId: string): DocumentNode | null;
  getPath(nodeId: string): string[];
  applyPatch(patch: DocumentPatch): void;
}

export interface InternalDocumentNode {
  id: string;
  type: string;
  value?: string;
  children: InternalDocumentNode[];
  from: number;
  to: number;
  parentId: string | null;
  source: string;
}

export interface DocumentTreeState {
  tree: InternalDocumentNode;
  byId: Map<string, InternalDocumentNode>;
}

function nodeValue(node: any): string | undefined {
  return typeof node.value === "string" ? node.value : undefined;
}

function nodeDisplayValue(node: any): string | undefined {
  const direct = nodeValue(node);
  if (direct !== undefined) return direct;
  if (node.type !== "paragraph" && node.type !== "heading") return undefined;
  const text = (Array.isArray(node.children) ? node.children : [])
    .map((child: any) => nodeDisplayValue(child) ?? "")
    .join("");
  return text;
}

function sourceRange(node: any, sourceLength: number): { from: number; to: number } {
  const from = typeof node.position?.start?.offset === "number" ? node.position.start.offset : 0;
  const to = typeof node.position?.end?.offset === "number"
    ? node.position.end.offset
    : node.type === "root" ? sourceLength : from;
  return {
    from: Math.max(0, Math.min(sourceLength, from)),
    to: Math.max(from, Math.min(sourceLength, to)),
  };
}

function snapshot(node: InternalDocumentNode): DocumentNode {
  const result: DocumentNode = { id: node.id, type: node.type };
  if (node.value !== undefined) result.value = node.value;
  if (node.children.length > 0) result.children = node.children.map(snapshot);
  return result;
}

function createInternal(
  node: any,
  source: string,
  parentId: string | null,
  previous: InternalDocumentNode | undefined,
  allocate: () => string,
): InternalDocumentNode {
  const children = Array.isArray(node.children) ? node.children : [];
  const oldChildren = previous?.children ?? [];
  const oldByKey = new Map<string, InternalDocumentNode[]>();
  for (const child of oldChildren) {
    const key = `${child.type}|${child.value ?? ""}|${child.source}`;
    const bucket = oldByKey.get(key) ?? [];
    bucket.push(child);
    oldByKey.set(key, bucket);
  }

  const mappedChildren: InternalDocumentNode[] = [];
  const used = new Set<string>();
  const matches: Array<InternalDocumentNode | undefined> = [];
  for (const child of children) {
    const childRange = sourceRange(child, source.length);
    const key = `${child.type}|${nodeDisplayValue(child) ?? ""}|${source.slice(childRange.from, childRange.to)}`;
    const exact = oldByKey.get(key)?.find((candidate) => !used.has(candidate.id));
    matches.push(exact);
    if (exact) used.add(exact.id);
  }
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const positional = oldChildren[index] && !used.has(oldChildren[index].id) ? oldChildren[index] : undefined;
    const matching = matches[index] ?? (positional && positional.type === child.type ? positional : undefined);
    if (matching) used.add(matching.id);
    mappedChildren.push(createInternal(child, source, "", matching, allocate));
  }

  const range = sourceRange(node, source.length);
  const result: InternalDocumentNode = {
    id: previous?.id ?? (parentId === null ? "root" : allocate()),
    type: node.type,
    value: nodeDisplayValue(node),
    children: mappedChildren,
    from: range.from,
    to: range.to,
    parentId,
    source: source.slice(range.from, range.to),
  };
  for (const child of mappedChildren) child.parentId = result.id;
  return result;
}

export function createDocumentTree(
  ast: Root,
  source: string,
  previous: DocumentTreeState | undefined,
  nextId: () => string,
): DocumentTreeState {
  const tree = createInternal(ast, source, null, previous?.tree, nextId);
  const byId = new Map<string, InternalDocumentNode>();
  const visit = (node: InternalDocumentNode) => {
    byId.set(node.id, node);
    for (const child of node.children) visit(child);
  };
  visit(tree);
  return { tree, byId };
}

export function getDocumentSnapshot(state: DocumentTreeState): DocumentNode {
  return snapshot(state.tree);
}

export function getNodeSnapshot(state: DocumentTreeState, id: string): DocumentNode | null {
  const node = state.byId.get(id);
  return node ? snapshot(node) : null;
}

export function getNodePath(state: DocumentTreeState, id: string): string[] {
  const node = state.byId.get(id);
  if (!node) return [];
  const path: string[] = [];
  let current: InternalDocumentNode | undefined = node;
  while (current) {
    path.unshift(current.type);
    current = current.parentId ? state.byId.get(current.parentId) : undefined;
  }
  return path;
}

export function getInternalNode(state: DocumentTreeState, id: string): InternalDocumentNode | undefined {
  return state.byId.get(id);
}

export function findNodeIndex(parent: InternalDocumentNode, id: string): number {
  return parent.children.findIndex((child) => child.id === id);
}

export function serializeDocumentContent(content: DocumentNodeContent): string {
  if (typeof content === "string") return content;
  if (content.type === "root") return (content.children ?? []).map(serializeDocumentContent).join("\n\n");
  if (content.type === "heading") {
    const depth = Math.max(1, Math.min(6, content.depth ?? 1));
    const text = content.value ?? (content.children ?? []).map(serializeDocumentContent).join("");
    return `${"#".repeat(depth)} ${text}`;
  }
  if (content.value !== undefined) return content.value;
  return (content.children ?? []).map(serializeDocumentContent).join("");
}
