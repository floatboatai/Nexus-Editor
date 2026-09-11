import { parse } from "csv-parse/browser/esm/sync";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkStringify from "remark-stringify";
import type { Root, TableCell } from "mdast";
import type { ConversionOptions, ConversionResult, DocumentDiagnostic } from "./types";
import { checkBytes, DocumentLimitError, limits, throwIfAborted } from "./limits";

export interface CsvConversionOptions extends Pick<ConversionOptions, "limits" | "signal"> {
  readonly delimiter?: string;
  readonly header?: "first-row" | "generate";
}

export async function convertCsv(source: string, options: CsvConversionOptions = {}): Promise<ConversionResult> {
  const budget = limits(options.limits);
  throwIfAborted(options.signal);
  checkBytes(source, budget.maxInputBytes, "CSV input");
  const records: string[][] = parse(source, {
    bom: true,
    delimiter: options.delimiter ?? ",",
    relax_column_count: true,
    max_record_size: budget.maxInputBytes,
    skip_empty_lines: true,
    cast: false,
  });
  const diagnostics: DocumentDiagnostic[] = [];
  const width = records.reduce((maximum, record) => Math.max(maximum, record.length), 0);
  if (records.length * width > budget.maxNodes) throw new DocumentLimitError("CSV exceeds its cell budget");
  if (!records.length) return { markdown: "", assetPlan: [], diagnostics };
  if (records.some((record) => record.length !== width)) diagnostics.push({ code: "conversion-warning", message: "Unequal CSV rows were padded; no cells were dropped" });
  if (options.header === "generate") records.unshift(Array.from({ length: width }, (_, index) => `Column ${index + 1}`));
  const cell = (value: string): TableCell => ({
    type: "tableCell",
    children: value.split(/\r\n|\r|\n/).flatMap((line, index) => [
      ...(index ? [{ type: "html" as const, value: "<br>" }] : []),
      { type: "text" as const, value: line },
    ]),
  });
  const tree: Root = { type: "root", children: [{ type: "table", children: records.map((record) => ({
    type: "tableRow", children: Array.from({ length: width }, (_, index) => cell(record[index] ?? "")),
  })) }] };
  const markdown = unified().use(remarkGfm).use(remarkStringify).stringify(tree);
  checkBytes(markdown, budget.maxOutputBytes, "Converted Markdown");
  throwIfAborted(options.signal);
  return { markdown, assetPlan: [], diagnostics };
}
