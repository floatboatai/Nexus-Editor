import { describe, expect, it } from "vitest";

import {
  appendTableColumn,
  clearTableCellRange,
  deleteTableColumn,
  isSeparatorLine,
  moveTableColumn,
  serializeRowCells,
  splitRowCells,
  tableColumnCount,
} from "../src/table-markdown";

// The user's original reproduction of the drag corruption: header omits its leading pipe and
// carries a trailing empty column. Built from an array so the exact interior
// whitespace (e.g. "职位  " with two spaces) survives editor auto-formatting.
const USER_REPORT = [
  "姓名 | 年龄 | 职位  |  |",
  "| --- | --- | ---  | --- |",
  "| 张三 | 25 | 提示词工程师  |  |",
  "| 李四 | 30 | 测开工程师  |  |",
].join("\n");

const WELLFORMED = [
  "| a | b | c |",
  "| --- | --- | --- |",
  "| 1 | 2 | 3 |",
  "| 4 | 5 | 6 |",
].join("\n");

// First table of the adjacent-tables corpus case — the pure functions only ever
// receive a single table's source, so the isolation guarantee is covered at the
// widget level and here we just exercise the source transform.
const FIRST_TABLE = [
  "| a | b | c |",
  "| --- | --- | --- |",
  "| 1 | 2 | 3 |",
].join("\n");

interface MoveCase {
  id: string;
  input: string;
  from: number;
  to: number;
}

// The reproduction corpus for the ragged-table drag corruption. The
// wide-viewport case is a layout-dependent UX issue and is intentionally not
// ported (jsdom has no layout).
const CORPUS_MOVE_CASES: MoveCase[] = [
  { id: "tabledrag-user-report", input: USER_REPORT, from: 1, to: 2 },
  {
    id: "tabledrag-header-no-leading-pipe",
    input: ["姓名 | 年龄 | 职位", "| --- | --- | --- |", "| 张三 | 25 | 工程师 |"].join("\n"),
    from: 0,
    to: 2,
  },
  {
    id: "tabledrag-header-no-trailing-pipe",
    input: ["| 姓名 | 年龄 | 职位", "| --- | --- | --- |", "| 张三 | 25 | 工程师 |"].join("\n"),
    from: 2,
    to: 0,
  },
  {
    id: "tabledrag-bare-no-pipes",
    input: ["a | b | c", "--- | --- | ---", "1 | 2 | 3"].join("\n"),
    from: 0,
    to: 1,
  },
  {
    id: "tabledrag-trailing-empty-column",
    input: ["| 姓名 | 年龄 | 职位 |  |", "| --- | --- | --- | --- |", "| 张三 | 25 | 工程师 |  |"].join("\n"),
    from: 1,
    to: 2,
  },
  { id: "tabledrag-wellformed", input: WELLFORMED, from: 0, to: 2 },
  { id: "tabledrag-adjacent-tables-no-merge", input: FIRST_TABLE, from: 0, to: 2 },
];

function columnCount(lines: string[]): number {
  return lines.reduce((max, line) => Math.max(max, splitRowCells(line).length), 0);
}

// Multiset of trimmed cell values across the padded table. A pure column move
// only permutes columns, so the padded input bag and the output bag must be
// equal — this catches lost, duplicated, or cross-column-leaked cells.
function trimmedCellBag(source: string): Map<string, number> {
  const lines = source.split("\n");
  const cols = columnCount(lines);
  const bag = new Map<string, number>();
  lines.forEach((line, index) => {
    const cells = splitRowCells(line);
    const filler = index === 1 ? "---" : "";
    while (cells.length < cols) cells.push(filler);
    for (const cell of cells) {
      const key = cell.trim();
      bag.set(key, (bag.get(key) ?? 0) + 1);
    }
  });
  return bag;
}

function expectMovePreservesTable(input: string, from: number, to: number): void {
  const output = moveTableColumn(input, from, to);
  const inLines = input.split("\n");
  const outLines = output.split("\n");

  // Row count is unchanged.
  expect(outLines.length).toBe(inLines.length);

  // Every row ends up with the same column count.
  const outColCounts = outLines.map((line) => splitRowCells(line).length);
  expect(new Set(outColCounts).size).toBe(1);

  // Every rewritten row is normalized with leading/trailing pipes.
  for (const line of outLines) {
    expect(line.startsWith("|")).toBe(true);
    expect(line.endsWith("|")).toBe(true);
  }

  // No cell is lost, duplicated, or leaked into another column.
  expect(trimmedCellBag(output)).toEqual(trimmedCellBag(input));
}

describe("table-markdown pure functions", () => {
  describe("splitRowCells", () => {
    it("splits a ragged row with a trailing empty column into all cells", () => {
      expect(splitRowCells("姓名 | 年龄 | 职位  |  |")).toEqual(["姓名 ", " 年龄 ", " 职位  ", "  "]);
    });

    it("does not split on escaped pipes", () => {
      expect(splitRowCells("| a | b\\| c |")).toEqual([" a ", " b\\| c "]);
    });

    it("splits a bare row that omits leading and trailing pipes", () => {
      expect(splitRowCells("a | b | c")).toEqual(["a ", " b ", " c"]);
    });

    it("strips at most one leading and one trailing pipe", () => {
      expect(splitRowCells("| x | y |")).toEqual([" x ", " y "]);
    });
  });

  describe("serializeRowCells", () => {
    it("wraps cells with leading and trailing pipes", () => {
      expect(serializeRowCells([" a ", " b "])).toBe("| a | b |");
    });

    it("round-trips zero-width cells byte-identically", () => {
      expect(serializeRowCells(["", " a "])).toBe("|| a |");
      expect(serializeRowCells(["x", "", "y"])).toBe("|x||y|");
    });
  });

  describe("isSeparatorLine", () => {
    it("recognizes separators with or without pipes and with alignment markers", () => {
      expect(isSeparatorLine("| --- | :--- |")).toBe(true);
      expect(isSeparatorLine("--- | ---")).toBe(true);
      expect(isSeparatorLine("| :---: | ---: |")).toBe(true);
    });

    it("rejects data rows", () => {
      expect(isSeparatorLine("| a | b |")).toBe(false);
      expect(isSeparatorLine("姓名 | 年龄 | 职位")).toBe(false);
    });
  });

  describe("moveTableColumn", () => {
    for (const testCase of CORPUS_MOVE_CASES) {
      it(`preserves every cell for corpus case ${testCase.id}`, () => {
        expectMovePreservesTable(testCase.input, testCase.from, testCase.to);
      });
    }

    it("normalizes the user-report case byte-for-byte, adding the missing leading pipe (from 1 to 2)", () => {
      const expected = [
        "|姓名 | 职位  | 年龄 |  |",
        "| --- | ---  | --- | --- |",
        "| 张三 | 提示词工程师  | 25 |  |",
        "| 李四 | 测开工程师  | 30 |  |",
      ].join("\n");
      expect(moveTableColumn(USER_REPORT, 1, 2)).toBe(expected);
    });

    it("moves a column byte-for-byte in a well-formed table (from 0 to 2)", () => {
      const expected = [
        "| b | c | a |",
        "| --- | --- | --- |",
        "| 2 | 3 | 1 |",
        "| 5 | 6 | 4 |",
      ].join("\n");
      expect(moveTableColumn(WELLFORMED, 0, 2)).toBe(expected);
    });

    it("moves alignment markers together with their column", () => {
      const input = ["| a | b | c |", "| :--- | ---: | :---: |", "| 1 | 2 | 3 |"].join("\n");
      expect(moveTableColumn(input, 0, 2).split("\n")[1]).toBe("| ---: | :---: | :--- |");
    });

    it("returns the table unchanged when from equals to", () => {
      expect(moveTableColumn(WELLFORMED, 1, 1)).toBe(WELLFORMED);
    });

    it("returns the table unchanged for out-of-range indices", () => {
      expect(moveTableColumn(WELLFORMED, 0, 99)).toBe(WELLFORMED);
      expect(moveTableColumn(WELLFORMED, 99, 0)).toBe(WELLFORMED);
    });

    it("leaves a single-column table unchanged", () => {
      const single = ["| a |", "| --- |", "| 1 |"].join("\n");
      expect(moveTableColumn(single, 0, 0)).toBe(single);
      expect(moveTableColumn(single, 0, 3)).toBe(single);
    });

    it("keeps untouched zero-width cells byte-identical when another column moves", () => {
      const input = ["| a || c |", "| --- | --- | --- |", "| 1 || 3 |"].join("\n");
      const lines = moveTableColumn(input, 0, 2).split("\n");
      expect(lines[0]).toBe("|| c | a |");
      expect(lines[2]).toBe("|| 3 | 1 |");
    });

    it("returns the table unchanged for negative indices", () => {
      expect(moveTableColumn(WELLFORMED, -1, 0)).toBe(WELLFORMED);
      expect(moveTableColumn(WELLFORMED, 0, -1)).toBe(WELLFORMED);
    });

    it("treats a dash-only body row as data, not a delimiter", () => {
      const input = ["| a | b | c |", "| --- | --- | --- |", "| - |", "| 1 | 2 | 3 |"].join("\n");
      const lines = moveTableColumn(input, 0, 2).split("\n");
      expect(lines[2]).toBe("|  |  | - |");
      expect(lines[2].includes("---")).toBe(false);
    });

    it("preserves escaped pipes when moving a column", () => {
      const input = ["| a | b\\| c | d |", "| --- | --- | --- |", "| 1 | 2 | 3 |"].join("\n");
      const headerLine = moveTableColumn(input, 0, 2).split("\n")[0];
      expect(headerLine).toBe("| b\\| c | d | a |");
      expect(splitRowCells(headerLine)).toEqual([" b\\| c ", " d ", " a "]);
    });
  });

  describe("deleteTableColumn", () => {
    it("deletes a column from a ragged table without dropping the leading or trailing cells", () => {
      const lines = deleteTableColumn(USER_REPORT, 0).split("\n");
      expect(lines.length).toBe(4);
      expect(lines.map((line) => splitRowCells(line).length)).toEqual([3, 3, 3, 3]);
      for (const line of lines) {
        expect(line.startsWith("|")).toBe(true);
        expect(line.endsWith("|")).toBe(true);
      }
      expect(lines[0]).toBe("| 年龄 | 职位  |  |");
    });

    it("deletes a column from a well-formed table byte-for-byte", () => {
      const input = ["| a | b | c |", "| --- | --- | --- |", "| 1 | 2 | 3 |"].join("\n");
      const expected = ["| a | c |", "| --- | --- |", "| 1 | 3 |"].join("\n");
      expect(deleteTableColumn(input, 1)).toBe(expected);
    });

    it("returns the table unchanged when the column index is out of range", () => {
      const input = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
      expect(deleteTableColumn(input, 99)).toBe(input);
    });

    it("returns the table unchanged for a negative column index", () => {
      const input = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
      expect(deleteTableColumn(input, -1)).toBe(input);
    });

    it("pads a short dash-only body row with empty cells, not dashes", () => {
      const input = ["| a | b | c |", "| --- | --- | --- |", "| - |", "| 1 | 2 | 3 |"].join("\n");
      const lines = deleteTableColumn(input, 2).split("\n");
      expect(lines[2]).toBe("| - |  |");
    });

    it("keeps untouched zero-width cells byte-identical when another column is deleted", () => {
      const input = ["| a || c |", "| --- | --- | --- |", "| 1 || 3 |"].join("\n");
      const expected = ["| a ||", "| --- | --- |", "| 1 ||"].join("\n");
      expect(deleteTableColumn(input, 2)).toBe(expected);
    });
  });

  describe("appendTableColumn", () => {
    it("appends an empty column to a well-formed table exactly like the previous behavior", () => {
      const expected = [
        "| a | b | c |  |",
        "| --- | --- | --- | --- |",
        "| 1 | 2 | 3 |  |",
        "| 4 | 5 | 6 |  |",
      ].join("\n");
      expect(appendTableColumn(WELLFORMED)).toBe(expected);
    });

    it("aligns ragged rows before appending so the new column lands at the same index everywhere", () => {
      const input = ["a | b", "| --- | --- | --- |", "| 1 | 2 | 3 |"].join("\n");
      const lines = appendTableColumn(input).split("\n");
      const counts = lines.map((line) => splitRowCells(line).length);
      expect(new Set(counts).size).toBe(1);
      expect(lines[0].startsWith("|")).toBe(true);
    });

    it("pads a dash-only body row with empty cells while extending the delimiter row with dashes", () => {
      const input = ["| a | b |", "| --- | --- |", "| - |"].join("\n");
      const lines = appendTableColumn(input).split("\n");
      expect(lines[1]).toBe("| --- | --- | --- |");
      expect(lines[2]).toBe("| - |  |  |");
    });
  });

  describe("tableColumnCount", () => {
    it("returns the max cell count across all rows", () => {
      expect(tableColumnCount(WELLFORMED)).toBe(3);
      expect(tableColumnCount(["| a |", "| --- |", "| 1 | 2 | 3 |"].join("\n"))).toBe(3);
    });
  });

  describe("clearTableCellRange", () => {
    it("clears a ragged cell and normalizes only the touched row", () => {
      const lines = clearTableCellRange(USER_REPORT, 0, 0, 0, 0).split("\n");
      // Touched header row: cleared cell + newly added leading pipe.
      expect(lines[0]).toBe("|  | 年龄 | 职位  |  |");
      // Untouched rows stay byte-identical (no normalization).
      expect(lines[1]).toBe("| --- | --- | ---  | --- |");
      expect(lines[2]).toBe("| 张三 | 25 | 提示词工程师  |  |");
      expect(lines[3]).toBe("| 李四 | 30 | 测开工程师  |  |");
    });

    it("maps row indices positionally so a dash-only body row is cleared, not its neighbor", () => {
      const input = ["| a | b |", "| --- | --- |", "| - | - |", "| x | y |"].join("\n");
      const lines = clearTableCellRange(input, 1, 0, 1, 1).split("\n");
      expect(lines[2]).toBe("|  |  |");
      expect(lines[3]).toBe("| x | y |");
    });

    it("ignores negative or out-of-range rows in the selection", () => {
      const input = ["| a | b |", "| --- | --- |", "| 1 | 2 |"].join("\n");
      expect(clearTableCellRange(input, -1, 0, -1, 0)).toBe(input);
      expect(clearTableCellRange(input, 5, 0, 9, 0)).toBe(input);
    });

    it("clears a range in a well-formed table leaving untouched rows byte-identical", () => {
      const input = [
        "| a | b | c |",
        "| --- | --- | --- |",
        "| 1 | 2 | 3 |",
        "| 4 | 5 | 6 |",
      ].join("\n");
      const lines = clearTableCellRange(input, 1, 0, 2, 1).split("\n");
      expect(lines[0]).toBe("| a | b | c |");
      expect(lines[1]).toBe("| --- | --- | --- |");
      expect(lines[2]).toBe("|  |  | 3 |");
      expect(lines[3]).toBe("|  |  | 6 |");
    });
  });
});
