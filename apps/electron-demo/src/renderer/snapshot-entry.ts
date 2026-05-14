export interface SnapshotEntry {
  id: string;
  docKey: string;
  filePath: string | null;
  title: string;
  content: string;
  createdAt: string;
  summary: string;
}
