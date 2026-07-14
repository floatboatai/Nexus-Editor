/**
 * Table creation tool for the Nexus Editor toolbar.
 * Provides a grid UI for quickly inserting N x M markdown tables.
 */
import type { EditorAPI } from "@floatboat/nexus-core";

const MAX_ROWS = 8;
const MAX_COLS = 8;

/**
 * Generate a markdown table string with the given dimensions.
 */
export function generateMarkdownTable(rows: number, cols: number): string {
  const header = "| " + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(" | ") + " |";
  const separator = "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |";
  const body = Array.from({ length: rows - 1 }, () =>
    "| " + Array.from({ length: cols }, () => "   ").join(" | ") + " |"
  ).join("\n");

  return [header, separator, body].filter(Boolean).join("\n") + "\n";
}

/**
 * Show a table size selector popup (grid of cells to pick rows x cols).
 */
export function showTableTool(
  anchor: HTMLElement,
  editor: EditorAPI,
  onClose?: () => void
): HTMLElement {
  const container = document.createElement("div");
  container.className = "nexus-table-tool";
  container.setAttribute("role", "dialog");
  container.setAttribute("aria-label", "Insert table");

  const label = document.createElement("div");
  label.className = "nexus-table-tool-label";
  label.textContent = "Select size";
  container.appendChild(label);

  const grid = document.createElement("div");
  grid.className = "nexus-table-tool-grid";
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = `repeat(${MAX_COLS}, 1fr)`;
  grid.style.gap = "2px";
  container.appendChild(grid);

  let selectedRows = 0;
  let selectedCols = 0;

  for (let r = 1; r <= MAX_ROWS; r++) {
    for (let c = 1; c <= MAX_COLS; c++) {
      const cell = document.createElement("div");
      cell.className = "nexus-table-tool-cell";
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.style.width = "16px";
      cell.style.height = "16px";
      cell.style.border = "1px solid #ccc";
      cell.style.borderRadius = "2px";

      cell.addEventListener("mouseenter", () => {
        selectedRows = r;
        selectedCols = c;
        label.textContent = `${r} x ${c}`;
        // Highlight cells
        const cells = Array.from(grid.querySelectorAll<HTMLElement>(".nexus-table-tool-cell"));
        for (const el of cells) {
          const er = Number(el.dataset.row);
          const ec = Number(el.dataset.col);
          el.style.background = er <= r && ec <= c ? "#4a9eff" : "";
        }
      });

      cell.addEventListener("click", () => {
        const table = generateMarkdownTable(selectedRows, selectedCols);
        editor.replaceSelection("\n" + table + "\n");
        editor.focus();
        close();
      });

      grid.appendChild(cell);
    }
  }

  // Position
  const rect = anchor.getBoundingClientRect();
  container.style.position = "fixed";
  container.style.left = `${rect.left}px`;
  container.style.top = `${rect.bottom + 4}px`;
  container.style.zIndex = "9999";
  container.style.padding = "8px";
  container.style.background = "var(--nexus-bg, #fff)";
  container.style.border = "1px solid #ddd";
  container.style.borderRadius = "4px";
  container.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";

  document.body.appendChild(container);

  function close() {
    container.remove();
    document.removeEventListener("mousedown", outsideClick);
    onClose?.();
  }

  function outsideClick(e: MouseEvent) {
    if (!container.contains(e.target as Node) && e.target !== anchor) {
      close();
    }
  }

  setTimeout(() => document.addEventListener("mousedown", outsideClick), 0);
  return container;
}
