// apps/electron-demo/src/renderer/recent-files.ts
const STORAGE_KEY = 'nexus-recent-files';
const MAX_RECENT_FILES = 10;

export function getRecentFiles(): string[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function addRecentFile(filePath: string): void {
  if (!filePath) return;
  let files = getRecentFiles();
  // 移除已存在的相同路径，再将新路径插入到最前
  files = files.filter(f => f !== filePath);
  files.unshift(filePath);
  // 只保留最近的 N 个
  if (files.length > MAX_RECENT_FILES) {
    files = files.slice(0, MAX_RECENT_FILES);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
  } catch {
    // 忽略存储错误
  }
}