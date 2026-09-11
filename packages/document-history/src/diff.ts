import { diffLines } from "diff";
import { throwIfHistoryAborted } from "./types";

export interface DocumentDiffHunk {
  /** All positions are UTF-16 offsets into the original arguments, not byte offsets. */
  readonly before: { readonly from: number; readonly to: number };
  readonly after: { readonly from: number; readonly to: number };
}

export interface DocumentDiffOptions {
  readonly maxInputLength?: number;
  readonly maxLines?: number;
  readonly maxEditLength?: number;
  readonly maxHunks?: number;
  readonly timeoutMs?: number;
  /** Checked before and after synchronous work. Use a host worker for hard cancellation. */
  readonly signal?: AbortSignal;
}

export type DocumentDiffResult =
  | { readonly status: "complete"; readonly hunks: readonly DocumentDiffHunk[] }
  | { readonly status: "limited"; readonly reason: "input" | "lines" | "work" | "output" };

function budget(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0) throw new RangeError(`${name} must be a non-negative safe integer`);
  return resolved;
}

function tooManyLines(text: string, maximum: number): boolean {
  let lines = text.length ? 1 : 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1;
    if (lines > maximum) return true;
  }
  return lines > maximum;
}

/** Exact line-level differences. Whitespace and EOF newlines are never ignored. */
export function diffDocumentText(before: string, after: string, options: DocumentDiffOptions = {}): DocumentDiffResult {
  throwIfHistoryAborted(options.signal);
  const maxInputLength = budget(options.maxInputLength, 1_000_000, "maxInputLength");
  const maxLines = budget(options.maxLines, 50_000, "maxLines");
  const maxEditLength = budget(options.maxEditLength, 20_000, "maxEditLength");
  const maxHunks = budget(options.maxHunks, 2000, "maxHunks");
  const timeout = budget(options.timeoutMs, 50, "timeoutMs");
  if (before.length > maxInputLength || after.length > maxInputLength) return Object.freeze({ status: "limited", reason: "input" });
  if (tooManyLines(before, maxLines) || tooManyLines(after, maxLines)) return Object.freeze({ status: "limited", reason: "lines" });
  if (before === after) return Object.freeze({ status: "complete", hunks: Object.freeze([]) });
  if (timeout === 0) return Object.freeze({ status: "limited", reason: "work" });
  const changes = diffLines(before, after, { maxEditLength, timeout });
  throwIfHistoryAborted(options.signal);
  if (!changes) return Object.freeze({ status: "limited", reason: "work" });
  const hunks: DocumentDiffHunk[] = [];
  let fromBefore = 0, fromAfter = 0;
  let pending: { before: { from: number; to: number }; after: { from: number; to: number } } | null = null;
  const flush = () => {
    if (!pending) return;
    hunks.push(Object.freeze({ before: Object.freeze(pending.before), after: Object.freeze(pending.after) }));
    pending = null;
  };
  for (const change of changes) {
    if (!change.added && !change.removed) {
      flush();
      fromBefore += change.value.length;
      fromAfter += change.value.length;
    } else {
      pending ??= { before: { from: fromBefore, to: fromBefore }, after: { from: fromAfter, to: fromAfter } };
      if (change.removed) fromBefore += change.value.length;
      else fromAfter += change.value.length;
      pending.before.to = fromBefore;
      pending.after.to = fromAfter;
    }
    if (hunks.length > maxHunks) return Object.freeze({ status: "limited", reason: "output" });
  }
  flush();
  if (hunks.length > maxHunks) return Object.freeze({ status: "limited", reason: "output" });
  return Object.freeze({ status: "complete", hunks: Object.freeze(hunks) });
}
