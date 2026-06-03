import './BacklinksPanel.css';

export interface BacklinkHit {
  sourcePath: string;
  snippet: string;
}

export interface BacklinksPanelOptions {
  onOpenFile(filePath: string): void;
  getActiveFile(): string | null;
  getFileContent(filePath: string): string | null;
}

export interface BacklinksPanel {
  element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

function findWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g;
  const matches: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    matches.push(match[1]);
  }
  return matches;
}

function resolveWikiLink(link: string, allFiles: string[]): string | null {
  const lowerLink = link.toLowerCase().replace(/\.md$/, '');
  for (const file of allFiles) {
    const fileName = basename(file).toLowerCase().replace(/\.md$/, '');
    if (fileName === lowerLink) {
      return file;
    }
  }
  return null;
}

export function createBacklinksPanel(options: BacklinksPanelOptions): BacklinksPanel {
  const { onOpenFile, getActiveFile, getFileContent } = options;

  const root = document.createElement("aside");
  root.className = "backlinks-panel";

  const header = document.createElement("div");
  header.className = "backlinks-header";
  header.textContent = "Backlinks";
  root.appendChild(header);

  const list = document.createElement("div");
  list.className = "backlinks-list";
  root.appendChild(list);

  function renderSectionHeader(title: string, count: number, parent: HTMLElement): HTMLElement {
    const h = document.createElement("div");
    h.className = "backlinks-section-header";
    const label = document.createElement("span");
    label.textContent = title;
    const badge = document.createElement("span");
    badge.className = "backlinks-badge";
    badge.textContent = String(count);
    h.append(label, badge);
    parent.appendChild(h);
    return h;
  }

  function renderItem(hit: BacklinkHit, parent: HTMLElement): void {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "backlinks-item";
    btn.addEventListener("click", () => onOpenFile(hit.sourcePath));

    const title = document.createElement("div");
    title.className = "backlinks-item-title";
    title.textContent = basename(hit.sourcePath);
    title.title = hit.sourcePath;
    btn.appendChild(title);

    const snippet = document.createElement("div");
    snippet.className = "backlinks-item-snippet";
    snippet.textContent = hit.snippet || "(empty)";
    btn.appendChild(snippet);

    parent.appendChild(btn);
  }

  function renderEmpty(reason: string, parent: HTMLElement): void {
    const empty = document.createElement("div");
    empty.className = "backlinks-empty";
    empty.textContent = reason;
    parent.appendChild(empty);
  }

  function getAllFiles(): string[] {
    try {
      const raw = localStorage.getItem("nexus-web-vault");
      if (raw) {
        const storage = JSON.parse(raw);
        return Object.keys(storage.files || {});
      }
    } catch {
      /* ignore */
    }
    return [];
  }

  function getBacklinks(filePath: string): BacklinkHit[] {
    const allFiles = getAllFiles();
    const backlinks: BacklinkHit[] = [];
    const currentFileName = basename(filePath).replace(/\.md$/, '').toLowerCase();

    for (const file of allFiles) {
      if (file === filePath) continue;

      const content = getFileContent(file);
      if (!content) continue;

      const links = findWikiLinks(content);
      for (const link of links) {
        const resolved = resolveWikiLink(link, allFiles);
        if (resolved === filePath) {
          const lines = content.split('\n');
          for (const line of lines) {
            if (line.includes(`[[${link}]]`)) {
              backlinks.push({
                sourcePath: file,
                snippet: line.trim().replace(/\[\[([^\]]+)\]\]/g, '$1'),
              });
              break;
            }
          }
        }
      }
    }

    return backlinks;
  }

  function getUnlinkedMentions(filePath: string): BacklinkHit[] {
    const allFiles = getAllFiles();
    const unlinked: BacklinkHit[] = [];
    const currentFileName = basename(filePath).replace(/\.md$/, '').toLowerCase();

    for (const file of allFiles) {
      if (file === filePath) continue;

      const content = getFileContent(file);
      if (!content) continue;

      if (content.toLowerCase().includes(currentFileName) && !content.includes(`[[${currentFileName}`)) {
        const lines = content.split('\n');
        for (const line of lines) {
          if (line.toLowerCase().includes(currentFileName)) {
            unlinked.push({
              sourcePath: file,
              snippet: line.trim(),
            });
            break;
          }
        }
      }
    }

    return unlinked;
  }

  function refresh(): void {
    list.textContent = "";
    const active = getActiveFile();
    if (!active) {
      header.textContent = "Backlinks";
      renderEmpty("No active file", list);
      return;
    }

    const linked = getBacklinks(active);
    const unlinked = getUnlinkedMentions(active);

    header.textContent = `Backlinks · ${linked.length} linked · ${unlinked.length} mentions`;

    renderSectionHeader("Linked mentions", linked.length, list);
    if (linked.length === 0) {
      renderEmpty("No linked mentions", list);
    } else {
      for (const hit of linked) renderItem(hit, list);
    }

    renderSectionHeader("Unlinked mentions", unlinked.length, list);
    if (unlinked.length === 0) {
      renderEmpty("No unlinked mentions", list);
    } else {
      for (const hit of unlinked) renderItem(hit, list);
    }
  }

  refresh();

  return {
    element: root,
    refresh,
    destroy() {
      root.remove();
    },
  };
}