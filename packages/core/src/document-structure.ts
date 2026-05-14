import type { Root } from "mdast";

import { lezerStringToMdast } from "./lezer-mdast-adapter";

export type DocumentStructureInput = Root | string;

export interface DocumentStructureOptions {
  requiredHeadings?: string[];
  maxSectionWords?: number;
}

export interface DocumentStructureHeading {
  index: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  from?: number;
  to?: number;
  parentIndex?: number;
}

export interface DocumentStructureSection {
  headingIndex: number;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  from?: number;
  to?: number;
  wordCount: number;
}

export interface DocumentStructureStats {
  headings: number;
  sections: number;
  words: number;
  paragraphs: number;
  lists: number;
  tables: number;
  codeBlocks: number;
}

export type DocumentStructureIssueType =
  | "empty-heading"
  | "heading-level-skip"
  | "duplicate-heading"
  | "missing-required-heading"
  | "section-too-long";

export interface DocumentStructureIssue {
  type: DocumentStructureIssueType;
  severity: "warning";
  headingIndex?: number;
  firstHeadingIndex?: number;
  expected?: string;
  previousLevel?: number;
  actualLevel?: number;
  wordCount?: number;
  limit?: number;
  from?: number;
  to?: number;
}

export interface DocumentStructureAnalysis {
  headings: DocumentStructureHeading[];
  sections: DocumentStructureSection[];
  stats: DocumentStructureStats;
  issues: DocumentStructureIssue[];
}

interface MdastPosition {
  start?: { offset?: number };
  end?: { offset?: number };
}

interface MdastNode {
  type: string;
  value?: unknown;
  children?: MdastNode[];
  position?: MdastPosition;
  depth?: number;
}

function normalizeHeading(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function getOffset(position: MdastPosition | undefined, edge: "start" | "end"): number | undefined {
  const offset = position?.[edge]?.offset;
  return typeof offset === "number" ? offset : undefined;
}

function getPlainText(node: MdastNode): string {
  const parts: string[] = [];

  const visit = (current: MdastNode) => {
    if (current.type === "code") {
      return;
    }

    if (typeof current.value === "string") {
      parts.push(current.value);
    }

    for (const child of current.children ?? []) {
      visit(child);
    }
  };

  visit(node);
  return parts.join(" ");
}

function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu);
  return matches?.length ?? 0;
}

function toHeadingLevel(value: unknown): DocumentStructureHeading["level"] {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6
    ? value
    : 1;
}

function createEmptyStats(): DocumentStructureStats {
  return {
    headings: 0,
    sections: 0,
    words: 0,
    paragraphs: 0,
    lists: 0,
    tables: 0,
    codeBlocks: 0
  };
}

function collectStats(root: MdastNode): DocumentStructureStats {
  const stats = createEmptyStats();

  const visit = (node: MdastNode) => {
    switch (node.type) {
      case "heading":
        stats.headings++;
        break;
      case "paragraph":
        stats.paragraphs++;
        break;
      case "list":
        stats.lists++;
        break;
      case "table":
        stats.tables++;
        break;
      case "code":
        stats.codeBlocks++;
        break;
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  visit(root);
  stats.words = countWords(getPlainText(root));
  return stats;
}

function analyzeHeadings(children: MdastNode[], issues: DocumentStructureIssue[]): DocumentStructureHeading[] {
  const headings: DocumentStructureHeading[] = [];
  const stack: DocumentStructureHeading[] = [];
  const seen = new Map<string, number>();
  let previousLevel: DocumentStructureHeading["level"] | null = null;

  for (const child of children) {
    if (child.type !== "heading") {
      continue;
    }

    const level = toHeadingLevel(child.depth);
    const text = getPlainText(child).trim();
    const heading: DocumentStructureHeading = {
      index: headings.length,
      level,
      text,
      from: getOffset(child.position, "start"),
      to: getOffset(child.position, "end")
    };

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    if (stack.length > 0) {
      heading.parentIndex = stack[stack.length - 1].index;
    }
    stack.push(heading);

    if (!text) {
      issues.push({
        type: "empty-heading",
        severity: "warning",
        headingIndex: heading.index,
        from: heading.from,
        to: heading.to
      });
    }

    if (previousLevel !== null && level > previousLevel + 1) {
      issues.push({
        type: "heading-level-skip",
        severity: "warning",
        headingIndex: heading.index,
        previousLevel,
        actualLevel: level,
        from: heading.from,
        to: heading.to
      });
    }

    const normalized = normalizeHeading(text);
    if (normalized) {
      const firstHeadingIndex = seen.get(normalized);
      if (firstHeadingIndex === undefined) {
        seen.set(normalized, heading.index);
      } else {
        issues.push({
          type: "duplicate-heading",
          severity: "warning",
          headingIndex: heading.index,
          firstHeadingIndex,
          from: heading.from,
          to: heading.to
        });
      }
    }

    headings.push(heading);
    previousLevel = level;
  }

  return headings;
}

function createSections(
  children: MdastNode[],
  headings: DocumentStructureHeading[],
  options: DocumentStructureOptions,
  issues: DocumentStructureIssue[]
): DocumentStructureSection[] {
  const headingChildIndexes = children.reduce<number[]>((out, child, index) => {
    if (child.type === "heading") {
      out.push(index);
    }
    return out;
  }, []);
  const sections: DocumentStructureSection[] = [];
  const maxSectionWords =
    typeof options.maxSectionWords === "number" && options.maxSectionWords >= 0
      ? options.maxSectionWords
      : undefined;

  for (let i = 0; i < headingChildIndexes.length; i++) {
    const heading = headings[i];
    const startChildIndex = headingChildIndexes[i];
    let endChildIndex = children.length;

    for (let j = i + 1; j < headingChildIndexes.length; j++) {
      const nextHeading = headings[j];
      if (nextHeading.level <= heading.level) {
        endChildIndex = headingChildIndexes[j];
        break;
      }
    }

    const bodyNodes = children.slice(startChildIndex + 1, endChildIndex);
    const lastNode = children[endChildIndex - 1] ?? children[startChildIndex];
    const wordCount = countWords(bodyNodes.map(getPlainText).join(" "));
    const section: DocumentStructureSection = {
      headingIndex: heading.index,
      level: heading.level,
      title: heading.text,
      from: heading.from,
      to: getOffset(lastNode.position, "end") ?? heading.to,
      wordCount
    };

    sections.push(section);

    if (maxSectionWords !== undefined && wordCount > maxSectionWords) {
      issues.push({
        type: "section-too-long",
        severity: "warning",
        headingIndex: heading.index,
        wordCount,
        limit: maxSectionWords,
        from: section.from,
        to: section.to
      });
    }
  }

  return sections;
}

function addMissingRequiredHeadingIssues(
  headings: DocumentStructureHeading[],
  requiredHeadings: string[] | undefined,
  issues: DocumentStructureIssue[]
): void {
  if (!requiredHeadings || requiredHeadings.length === 0) {
    return;
  }

  const actual = new Set(headings.map((heading) => normalizeHeading(heading.text)).filter(Boolean));

  for (const requiredHeading of requiredHeadings) {
    const normalized = normalizeHeading(requiredHeading);
    if (!normalized || actual.has(normalized)) {
      continue;
    }

    issues.push({
      type: "missing-required-heading",
      severity: "warning",
      expected: requiredHeading
    });
  }
}

export function analyzeDocumentStructure(
  input: DocumentStructureInput,
  options: DocumentStructureOptions = {}
): DocumentStructureAnalysis {
  const root = (typeof input === "string" ? lezerStringToMdast(input) : input) as unknown as MdastNode;
  const children = root.children ?? [];
  const issues: DocumentStructureIssue[] = [];
  const headings = analyzeHeadings(children, issues);
  const sections = createSections(children, headings, options, issues);
  addMissingRequiredHeadingIssues(headings, options.requiredHeadings, issues);

  return {
    headings,
    sections,
    stats: {
      ...collectStats(root),
      sections: sections.length
    },
    issues
  };
}
