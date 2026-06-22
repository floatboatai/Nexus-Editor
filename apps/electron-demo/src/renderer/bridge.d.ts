interface DemoFileHandle {
  path: string;
  content: string;
}

interface VaultNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: VaultNode[];
}

interface VaultState {
  lastVault: string | null;
  recents: string[];
}

interface VaultBridge {
  pick(): Promise<{ path: string } | null>;
  list(vaultPath: string): Promise<VaultNode[]>;
  read(filePath: string): Promise<DemoFileHandle>;
  readAll(): Promise<Array<{ path: string; content: string }>>;
  write(filePath: string, content: string): Promise<{ path: string }>;
  createFile(parentDir: string, name: string): Promise<{ path: string }>;
  createFolder(parentDir: string, name: string): Promise<{ path: string }>;
  rename(oldPath: string, newName: string): Promise<{ path: string }>;
  delete(targetPath: string): Promise<{ ok: boolean }>;
  getLast(): Promise<VaultState>;
  setLast(vaultPath: string): Promise<{ ok: boolean }>;
  onChanged(cb: (payload: { vault: string }) => void): () => void;
}

type LLMWikiStatusState = "queued" | "running" | "succeeded" | "failed";
type LLMWikiSubmitMode = "manual" | "auto";
type LLMWikiDocumentStatusState = "dirty" | "queued" | "submitting" | "parsed" | "failed";

interface LLMWikiCommandResult {
  ok: boolean;
  operation: string;
  written?: string[];
  issues?: Array<Record<string, unknown>>;
  error?: string;
}

interface LLMWikiStatus {
  state: LLMWikiStatusState;
  projectPath: string;
  message?: string;
  result?: LLMWikiCommandResult;
}

interface LLMWikiDocumentStatus {
  status: LLMWikiDocumentStatusState;
  contentHash: string;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  error: string | null;
  generated: string[];
  events: string[];
}

interface LLMWikiStateFile {
  version: 1;
  mode: LLMWikiSubmitMode;
  documents: Record<string, LLMWikiDocumentStatus>;
  projectIssues: Array<{ code: string; path: string; message: string }>;
}

interface LLMWikiDocStatusPayload {
  projectPath: string;
  rawPath: string;
  status: LLMWikiDocumentStatus;
}

interface LLMWikiSaveSourceInput {
  content: string;
  currentPath?: string | null;
}

interface LLMWikiSaveSourceResult {
  projectPath: string;
  savedPath: string;
  pathKind: "raw" | "wiki" | "external";
  queued: boolean;
}

interface LLMWikiConfigInput {
  provider: "fixture" | "deepseek";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

interface LLMWikiConfigStatus {
  provider: "fixture" | "deepseek";
  model: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  envPath: string;
}

interface LLMWikiAskInput {
  projectPath?: string | null;
  question: string;
}

interface LLMWikiCitation {
  path: string;
  quote?: string;
}

interface LLMWikiAskResult extends LLMWikiCommandResult {
  operation: "query";
  answer: string;
  citations: LLMWikiCitation[];
  read: string[];
  usage?: Record<string, unknown>;
}

interface LLMWikiOpenSchemaResult {
  projectPath: string;
  schemaPath: string;
  content: string;
}

interface LLMWikiBridge {
  saveSource(input: LLMWikiSaveSourceInput): Promise<LLMWikiSaveSourceResult>;
  getStatus(): Promise<LLMWikiStatus | null>;
  getDocStatuses(): Promise<{ projectPath: string; state: LLMWikiStateFile }>;
  submitDoc(input: { rawPath: string }): Promise<{ projectPath: string; rawPath: string; status: LLMWikiDocumentStatus }>;
  submitAllDirty(): Promise<{ projectPath: string; submitted: string[] }>;
  retryFailed(): Promise<{ projectPath: string; submitted: string[] }>;
  getSubmitMode(): Promise<{ projectPath: string; mode: LLMWikiSubmitMode }>;
  setSubmitMode(mode: LLMWikiSubmitMode): Promise<{ projectPath: string; mode: LLMWikiSubmitMode }>;
  getConfigStatus(): Promise<LLMWikiConfigStatus>;
  saveConfig(input: LLMWikiConfigInput): Promise<LLMWikiConfigStatus>;
  ask(input: LLMWikiAskInput): Promise<LLMWikiAskResult>;
  openSchema(input?: { projectPath?: string | null }): Promise<LLMWikiOpenSchemaResult>;
  onStatus(cb: (status: LLMWikiStatus) => void): () => void;
  onDocStatus(cb: (payload: LLMWikiDocStatusPayload) => void): () => void;
}

interface DemoBridge {
  openFile(): Promise<DemoFileHandle | null>;
  saveFile(path: string, content: string): Promise<{ path: string }>;
  saveFileAs(content: string): Promise<{ path: string } | null>;
  vault: VaultBridge;
  llmWiki: LLMWikiBridge;
}

interface Window {
  nexusDemo: DemoBridge;
}

declare module "*?worker" {
  const WorkerCtor: {
    new (options?: { name?: string }): Worker;
  };
  export default WorkerCtor;
}
