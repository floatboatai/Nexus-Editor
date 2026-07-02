import type { EditorAPI } from "@floatboat/nexus-core";

import type {
  AIPendingOperation,
  AIToolCall,
  AIToolExecution,
  AIToolName,
  ParsedAIToolCall
} from "./types";

export const AI_TOOL_NAMES: readonly AIToolName[] = [
  "readDocument",
  "readSelection",
  "searchText",
  "replaceRange",
  "insertAt",
  "replaceSelection",
  "setSelection",
  "getTableOfContents"
];

const WRITE_TOOLS = new Set<AIToolName>(["replaceRange", "insertAt", "replaceSelection"]);

export function isWriteToolCall(call: AIToolCall): boolean {
  return WRITE_TOOLS.has(call.tool);
}

export const AI_TOOL_DEFINITIONS = [
  functionTool("readDocument", "Read the entire current Markdown document.", {}),
  functionTool("readSelection", "Read the current selected text and range.", {}),
  functionTool("searchText", "Search the current document for literal text and return matching ranges.", {
    query: { type: "string", description: "Text to search for." },
    caseSensitive: { type: "boolean", description: "Whether matching is case-sensitive." }
  }, ["query"]),
  functionTool("replaceRange", "Propose replacing a document range. Requires user approval before applying.", {
    from: { type: "integer", minimum: 0 },
    to: { type: "integer", minimum: 0 },
    text: { type: "string" }
  }, ["from", "to", "text"]),
  functionTool("insertAt", "Propose inserting text at a document offset. Requires user approval before applying.", {
    pos: { type: "integer", minimum: 0 },
    text: { type: "string" }
  }, ["pos", "text"]),
  functionTool("replaceSelection", "Propose replacing the current selection. Requires user approval before applying.", {
    text: { type: "string" }
  }, ["text"]),
  functionTool("setSelection", "Move or set the editor selection immediately.", {
    anchor: { type: "integer", minimum: 0 },
    head: { type: "integer", minimum: 0 }
  }, ["anchor"]),
  functionTool("getTableOfContents", "Read the document heading outline.", {})
] as const;

function functionTool(
  name: AIToolName,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false
      }
    }
  };
}

interface RawToolCall {
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

export function parseAssistantToolCalls(message: unknown): ParsedAIToolCall[] {
  const rawMessage = message as { tool_calls?: unknown; toolCalls?: unknown };
  const toolCalls = rawMessage.tool_calls ?? rawMessage.toolCalls;
  if (!Array.isArray(toolCalls)) return [];

  const parsed: ParsedAIToolCall[] = [];
  for (const raw of toolCalls as RawToolCall[]) {
    if (raw.type !== "function") continue;
    const name = raw.function?.name;
    if (!isToolName(name)) continue;
    const args = parseArguments(raw.function?.arguments);
    if (!args.ok) continue;
    const call = normalizeToolCall(name, args.value);
    if (call) {
      parsed.push({
        id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `call_${parsed.length + 1}`,
        call
      });
    }
  }

  return parsed;
}

function isToolName(value: unknown): value is AIToolName {
  return typeof value === "string" && (AI_TOOL_NAMES as readonly string[]).includes(value);
}

function parseArguments(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (value === undefined || value === "") return { ok: true, value: {} };
  if (typeof value !== "string") return { ok: false };
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function normalizeToolCall(name: AIToolName, args: unknown): AIToolCall | null {
  const obj = isRecord(args) ? args : {};
  switch (name) {
    case "readDocument":
    case "readSelection":
    case "getTableOfContents":
      return { tool: name };
    case "searchText":
      return typeof obj.query === "string"
        ? { tool: name, query: obj.query, caseSensitive: obj.caseSensitive === true }
        : null;
    case "replaceRange":
      return isInteger(obj.from) && isInteger(obj.to) && typeof obj.text === "string"
        ? { tool: name, from: obj.from, to: obj.to, text: obj.text }
        : null;
    case "insertAt":
      return isInteger(obj.pos) && typeof obj.text === "string"
        ? { tool: name, pos: obj.pos, text: obj.text }
        : null;
    case "replaceSelection":
      return typeof obj.text === "string" ? { tool: name, text: obj.text } : null;
    case "setSelection":
      return isInteger(obj.anchor) && (obj.head === undefined || isInteger(obj.head))
        ? { tool: name, anchor: obj.anchor, head: obj.head as number | undefined }
        : null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}

let operationCounter = 0;

type PendingOperationInput =
  | {
      kind: "replaceRange";
      from: number;
      to: number;
      text: string;
      before: string;
      after: string;
    }
  | {
      kind: "insertAt";
      pos: number;
      text: string;
      before: string;
      after: string;
    }
  | {
      kind: "replaceSelection";
      text: string;
      selection: { anchor: number; head: number };
      before: string;
      after: string;
    };

export function executeAIToolCall(editor: EditorAPI, call: AIToolCall): AIToolExecution {
  const doc = editor.getDocument();
  switch (call.tool) {
    case "readDocument":
      return ok(call.tool, { text: doc, length: doc.length });
    case "readSelection": {
      const selection = editor.getSelection();
      return ok(call.tool, {
        text: editor.getSelectedText(),
        selection
      });
    }
    case "searchText":
      return ok(call.tool, {
        matches: searchDocument(doc, call.query, call.caseSensitive === true)
      });
    case "getTableOfContents":
      return ok(call.tool, { entries: editor.getTableOfContents() });
    case "setSelection": {
      const validation = validateRange(doc, call.anchor, call.head ?? call.anchor);
      if (validation) return fail(call.tool, validation);
      editor.setSelection(call.anchor, call.head);
      return ok(call.tool, { selection: editor.getSelection() });
    }
    case "replaceRange": {
      const validation = validateRange(doc, call.from, call.to);
      if (validation) return fail(call.tool, validation);
      const before = doc.slice(call.from, call.to);
      const operation = createOperation({
        kind: "replaceRange",
        from: call.from,
        to: call.to,
        text: call.text,
        before,
        after: call.text
      });
      return pending(call.tool, operation);
    }
    case "insertAt": {
      const validation = validateRange(doc, call.pos, call.pos);
      if (validation) return fail(call.tool, validation);
      const operation = createOperation({
        kind: "insertAt",
        pos: call.pos,
        text: call.text,
        before: "",
        after: call.text
      });
      return pending(call.tool, operation);
    }
    case "replaceSelection": {
      const selection = editor.getSelection();
      const from = Math.min(selection.anchor, selection.head);
      const to = Math.max(selection.anchor, selection.head);
      const operation = createOperation({
        kind: "replaceSelection",
        text: call.text,
        selection,
        before: doc.slice(from, to),
        after: call.text
      });
      return pending(call.tool, operation);
    }
  }
}

function searchDocument(doc: string, query: string, caseSensitive: boolean) {
  if (!query) return [];
  const haystack = caseSensitive ? doc : doc.toLocaleLowerCase();
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches: Array<{ from: number; to: number; preview: string }> = [];
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    matches.push({
      from: index,
      to: index + query.length,
      preview: doc.slice(Math.max(0, index - 24), Math.min(doc.length, index + query.length + 24))
    });
    index = haystack.indexOf(needle, index + Math.max(1, needle.length));
  }
  return matches;
}

function validateRange(doc: string, from: number, to: number): string | null {
  if (!Number.isInteger(from) || !Number.isInteger(to)) return "Range offsets must be integers.";
  if (from < 0 || to < 0) return "Range offsets cannot be negative.";
  if (from > to) return "Range start cannot be after range end.";
  if (to > doc.length) return "Range end is outside the document.";
  return null;
}

function createOperation(operation: PendingOperationInput): AIPendingOperation {
  operationCounter += 1;
  return { id: `op_${operationCounter}`, ...operation };
}

function ok(tool: AIToolName, data: unknown): AIToolExecution {
  return { result: { ok: true, tool, data } };
}

function pending(tool: AIToolName, pendingOperation: AIPendingOperation): AIToolExecution {
  return {
    result: {
      ok: true,
      tool,
      data: {
        status: "pending_approval",
        operationId: pendingOperation.id,
        operation: pendingOperation
      }
    },
    pendingOperation
  };
}

function fail(tool: AIToolName, error: string): AIToolExecution {
  return { result: { ok: false, tool, error } };
}
