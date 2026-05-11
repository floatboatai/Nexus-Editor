import type { EditorAPI } from "./types";

interface StatsPanelOptions {
  editor: EditorAPI;
}

export interface StatsPanel {
  element: HTMLElement;
  destroy(): void;
}

interface DocumentStats {
  characters: number;
  charactersNoSpace: number;
  words: number;
  lines: number;
  paragraphs: number;
  readTime: number;
  headings: {
    h1: number;
    h2: number;
    h3: number;
    h4: number;
    h5: number;
    h6: number;
  };
  codeBlocks: number;
  links: number;
  images: number;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function createStatsPanel(opts: StatsPanelOptions): StatsPanel {
  const { editor } = opts;

  const el = document.createElement("div");
  el.className = "stats-panel";
  el.setAttribute("role", "tabpanel");
  el.setAttribute("aria-label", "Document Statistics");

  // 标题
  const header = document.createElement("div");
  header.className = "stats-panel-header";
  header.textContent = "STATS";
  el.appendChild(header);

  // 统计内容容器
  const content = document.createElement("div");
  content.className = "stats-panel-content";
  el.appendChild(content);

  // 更新统计显示
  function updateStats(): void {
    const stats = editor.getDocumentStats();
    renderStats(stats);
  }

  // 渲染统计数据
  function renderStats(stats: DocumentStats): void {
    content.innerHTML = `
      <div class="stats-section">
        <div class="stats-title">Basic</div>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">${formatNumber(stats.characters)}</span>
            <span class="stat-label">Characters</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${formatNumber(stats.charactersNoSpace)}</span>
            <span class="stat-label">Chars (no space)</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${formatNumber(stats.words)}</span>
            <span class="stat-label">Words</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${formatNumber(stats.lines)}</span>
            <span class="stat-label">Lines</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${formatNumber(stats.paragraphs)}</span>
            <span class="stat-label">Paragraphs</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.readTime}</span>
            <span class="stat-label">Min read</span>
          </div>
        </div>
      </div>

      <div class="stats-section">
        <div class="stats-title">Headings</div>
        <div class="stats-grid headings-grid">
          ${Object.entries(stats.headings).map(([level, count]) => `
            <div class="stat-item heading-item">
              <span class="heading-level">${level.toUpperCase()}</span>
              <span class="stat-value">${count}</span>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="stats-section">
        <div class="stats-title">Content</div>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">${formatNumber(stats.codeBlocks)}</span>
            <span class="stat-label">Code blocks</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${formatNumber(stats.links)}</span>
            <span class="stat-label">Links</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${formatNumber(stats.images)}</span>
            <span class="stat-label">Images</span>
          </div>
        </div>
      </div>
    `;
  }

  // 初始化渲染
  updateStats();

  // 监听文档变化
  const changeHandler = () => {
    updateStats();
  };
  editor.on("change", changeHandler);

  function destroy(): void {
    editor.off("change", changeHandler);
    el.remove();
  }

  return { element: el, destroy };
}