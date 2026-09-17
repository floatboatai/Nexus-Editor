# Benchmarks

Reproducible performance scenarios for the editor core. They exist to answer
one question per scenario with numbers that are comparable between runs on the
same machine — not to produce absolute rankings across machines.

## Running

```bash
pnpm build   # benchmarks import packages/core/dist, so build first
pnpm bench
```

Output: a table on stdout plus `bench/results/latest.json` (git-ignored) for
diffing two runs.

## Scenarios

| Scenario | Question it answers |
|---|---|
| `live-preview/cursor-move` | How expensive is one cursor move (arrow key, click) as the document grows? This is the per-keystroke path: it must not grow linearly with document size. |
| `live-preview/set-document` | What does a full document replace cost on a large document (cache-cold rebuild)? |
| `live-preview/create-editor` | What does mounting a fresh editor on a ~23KB document cost once modules are warm? |
| `api/export-html` | What does one `exportHTML()` call cost? |
| `api/get-ast` / `api/get-document-stats` | Cost of the read-only public APIs. |

Documents are generated deterministically (`bench/scenarios/documents.mjs`):
repeating sections with headings, inline formatting, links, lists, task lists
and a fenced code block every fifth section — the constructs the live preview
decorates.

## Method

- Each scenario runs 5 untimed warm-up iterations, then 30 timed ones.
- Reported: median and p95. Medians are the comparison metric; p95 catches tails.
- Everything runs in-process in jsdom, so absolute numbers are not comparable
  with a real browser. Ratios between scenarios on the same run are.
- No new dependencies: the harness is plain Node + the already-present jsdom.

## Regression budgets

`packages/core/test/live-preview-cursor-budget.test.ts` encodes the invariant
that mattered historically: **cursor-move latency must not scale linearly with
document size**. It asserts the ratio between cursor-move latency on a ~96KB
document and a ~4KB document stays below a fixed threshold. Ratios are used
instead of absolute milliseconds so the gate survives slower CI runners; the
threshold sits between the pre-optimization ratio (~5.2x) and the current one
(~2.5x).

## Adding a scenario

1. Create `bench/scenarios/<name>.mjs` exporting `run(measure): Row[]`.
2. Register the file in `bench/run.mjs` (`scenarioFiles`).
3. Keep scenarios black-box: drive the public API (`createEditor` and the
   `EditorAPI` methods), never internals — otherwise the benchmark stops
   measuring what consumers pay.
