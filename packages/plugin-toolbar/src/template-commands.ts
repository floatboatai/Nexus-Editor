import type { CoreEditorChange, EditorAPI, NexusPlugin, SelectionRangeJSON } from "@floatboat/nexus-core";

interface Template {
  readonly block: boolean;
  build(selected: string): {
    readonly text: string;
    readonly placeholderFrom: number;
    readonly placeholderTo: number;
  };
}

function wrappedTemplate(block: boolean, prefix: string, suffix: string, fallback: string): Template {
  return {
    block,
    build(selected) {
      const content = selected || fallback;
      return { text: prefix + content + suffix, placeholderFrom: prefix.length, placeholderTo: prefix.length + content.length };
    },
  };
}

const tableTemplate: Template = {
  block: true,
  build(selected) {
    // Escape backslashes first so an existing \| cannot become an unescaped table delimiter.
    const content = selected
      ? selected.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>")
      : "Column 1";
    return {
      text: `| ${content} | Column 2 |\n| --- | --- |\n| Cell | Cell |`,
      placeholderFrom: 2,
      placeholderTo: 2 + content.length,
    };
  },
};

const blockMathTemplate = wrappedTemplate(true, "$$\n", "\n$$", "E = mc^2");
const inlineMathTemplate = wrappedTemplate(false, "$", "$", "x");
const mermaidTemplate: Template = {
  block: true,
  build(selected) {
    const content = selected || "flowchart TD\n  A[Start] --> B[End]";
    let fenceLength = 3;
    for (const match of content.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
    const fence = "`".repeat(fenceLength);
    const prefix = `${fence}mermaid\n`;
    return {
      text: `${prefix}${content}\n${fence}`,
      placeholderFrom: prefix.length,
      placeholderTo: prefix.length + content.length,
    };
  },
};

function canInsert(editor: EditorAPI): boolean {
  if (typeof editor.isReadOnly !== "function" || editor.isReadOnly() !== false ||
    typeof editor.isComposing !== "function" || editor.isComposing() !== false ||
    typeof editor.getSelections !== "function" || typeof editor.getDocument !== "function" ||
    typeof editor.dispatchTransaction !== "function" || typeof editor.getContributionSink !== "function" ||
    typeof editor.focus !== "function") return false;
  const contributions = editor.getContributionSink();
  return Boolean(contributions) && typeof contributions.isInteractionActive === "function" && contributions.isInteractionActive() === false;
}

function leadingSeparation(before: string): string {
  return !before || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
}

function trailingSeparation(after: string): string {
  return !after || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
}

function insertTemplate(editor: EditorAPI, template: Template, commandId: string): boolean {
  if (!canInsert(editor)) return false;
  const source = editor.getDocument();
  const selections = editor.getSelections();
  if (!selections.ranges.length || !Number.isInteger(selections.mainIndex) ||
    selections.mainIndex < 0 || selections.mainIndex >= selections.ranges.length) return false;
  const ranges = selections.ranges.map(({ anchor, head }, index) => ({
    from: Math.min(anchor, head), to: Math.max(anchor, head), index,
  })).sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index], previous = ranges[index - 1];
    if (!Number.isSafeInteger(range.from) || !Number.isSafeInteger(range.to) || range.from < 0 || range.to > source.length ||
      (previous && (range.from < previous.to || range.from === previous.from))) return false;
  }

  const changes: CoreEditorChange[] = [];
  const nextSelections: SelectionRangeJSON[] = [];
  let delta = 0;
  let previousTo = 0;
  let tail = "";
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const nextFrom = ranges[index + 1]?.from ?? source.length;
    tail = (tail + source.slice(previousTo, range.from)).slice(-2);
    const built = template.build(source.slice(range.from, range.to));
    const prefix = template.block ? leadingSeparation(tail) : "";
    // Adjacent replacement blocks share one separator, added by the next prefix.
    const suffix = template.block ? trailingSeparation(source.slice(range.to, Math.min(range.to + 2, nextFrom))) : "";
    const insert = prefix + built.text + suffix;
    changes.push({ from: range.from, to: range.to, insert });
    nextSelections.push({
      anchor: range.from + delta + prefix.length + built.placeholderFrom,
      head: range.from + delta + prefix.length + built.placeholderTo,
    });
    delta += insert.length - (range.to - range.from);
    previousTo = range.to;
    tail = (tail + insert).slice(-2);
  }
  const result = editor.dispatchTransaction({
    changes,
    selection: {
      ranges: nextSelections,
      mainIndex: ranges.findIndex((range) => range.index === selections.mainIndex),
    },
    origin: [commandId],
    userEvent: "input.template",
    history: "isolate",
  });
  if (result.status !== "success") return false;
  editor.focus();
  return true;
}

export function insertTable(editor: EditorAPI): boolean {
  return insertTemplate(editor, tableTemplate, "template:insert-table");
}

export function insertMathBlock(editor: EditorAPI): boolean {
  return insertTemplate(editor, blockMathTemplate, "template:insert-math-block");
}

export function insertInlineMath(editor: EditorAPI): boolean {
  return insertTemplate(editor, inlineMathTemplate, "template:insert-inline-math");
}

export function insertMermaid(editor: EditorAPI): boolean {
  return insertTemplate(editor, mermaidTemplate, "template:insert-mermaid");
}

/** Opt-in commands only: no toolbar buttons, slash commands or default shortcuts. */
export function createTemplateCommandsPlugin(): NexusPlugin {
  return {
    name: "plugin-template-commands",
    commands: [
      { id: "template:insert-table", label: "Insert table", run: insertTable },
      { id: "template:insert-math-block", label: "Insert math block", run: insertMathBlock },
      { id: "template:insert-inline-math", label: "Insert inline math", run: insertInlineMath },
      { id: "template:insert-mermaid", label: "Insert Mermaid diagram", run: insertMermaid },
    ],
  };
}
