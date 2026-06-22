import { contextBridge, ipcRenderer } from "electron";

export interface DemoFileHandle {
  path: string;
  content: string;
}

export interface VaultNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: VaultNode[];
}

export interface VaultState {
  lastVault: string | null;
  recents: string[];
}

export interface VaultBridge {
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

export type LLMWikiStatusState = "queued" | "running" | "succeeded" | "failed";
export type LLMWikiSubmitMode = "manual" | "auto";
export type LLMWikiDocumentStatusState = "dirty" | "queued" | "submitting" | "parsed" | "failed";

export interface LLMWikiCommandResult {
  ok: boolean;
  operation: string;
  written?: string[];
  issues?: Array<Record<string, unknown>>;
  error?: string;
}

export interface LLMWikiStatus {
  state: LLMWikiStatusState;
  projectPath: string;
  message?: string;
  result?: LLMWikiCommandResult;
}

export interface LLMWikiDocumentStatus {
  status: LLMWikiDocumentStatusState;
  contentHash: string;
  updatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  error: string | null;
  generated: string[];
  events: string[];
}

export interface LLMWikiStateFile {
  version: 1;
  mode: LLMWikiSubmitMode;
  documents: Record<string, LLMWikiDocumentStatus>;
  projectIssues: Array<{ code: string; path: string; message: string }>;
}

export interface LLMWikiDocStatusPayload {
  projectPath: string;
  rawPath: string;
  status: LLMWikiDocumentStatus;
}

export interface LLMWikiSaveSourceInput {
  content: string;
  currentPath?: string | null;
}

export interface LLMWikiSaveSourceResult {
  projectPath: string;
  savedPath: string;
  pathKind: "raw" | "wiki" | "external";
  queued: boolean;
}

export interface LLMWikiConfigInput {
  provider: "fixture" | "deepseek";
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface LLMWikiConfigStatus {
  provider: "fixture" | "deepseek";
  model: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  envPath: string;
}

export interface LLMWikiAskInput {
  projectPath?: string | null;
  question: string;
}

export interface LLMWikiCitation {
  path: string;
  quote?: string;
}

export interface LLMWikiAskResult extends LLMWikiCommandResult {
  operation: "query";
  answer: string;
  citations: LLMWikiCitation[];
  read: string[];
  usage?: Record<string, unknown>;
}

export interface LLMWikiOpenSchemaResult {
  projectPath: string;
  schemaPath: string;
  content: string;
}

export interface LLMWikiBridge {
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

export interface DemoBridge {
  openFile(): Promise<DemoFileHandle | null>;
  saveFile(path: string, content: string): Promise<{ path: string }>;
  saveFileAs(content: string): Promise<{ path: string } | null>;
  vault: VaultBridge;
  llmWiki: LLMWikiBridge;
}

const vaultBridge: VaultBridge = {
  pick() {
    return ipcRenderer.invoke("vault:pick");
  },
  list(vaultPath) {
    return ipcRenderer.invoke("vault:list", vaultPath);
  },
  read(filePath) {
    return ipcRenderer.invoke("vault:read", filePath);
  },
  readAll() {
    return ipcRenderer.invoke("vault:read-all");
  },
  write(filePath, content) {
    return ipcRenderer.invoke("vault:write", filePath, content);
  },
  createFile(parentDir, name) {
    return ipcRenderer.invoke("vault:create-file", parentDir, name);
  },
  createFolder(parentDir, name) {
    return ipcRenderer.invoke("vault:create-folder", parentDir, name);
  },
  rename(oldPath, newName) {
    return ipcRenderer.invoke("vault:rename", oldPath, newName);
  },
  delete(targetPath) {
    return ipcRenderer.invoke("vault:delete", targetPath);
  },
  getLast() {
    return ipcRenderer.invoke("vault:get-last");
  },
  setLast(vaultPath) {
    return ipcRenderer.invoke("vault:set-last", vaultPath);
  },
  onChanged(cb) {
    const listener = (_event: Electron.IpcRendererEvent, payload: { vault: string }) => cb(payload);
    ipcRenderer.on("vault:changed", listener);
    return () => {
      ipcRenderer.off("vault:changed", listener);
    };
  },
};

const bridge: DemoBridge = {
  openFile() {
    return ipcRenderer.invoke("demo:open-file");
  },
  saveFile(path: string, content: string) {
    return ipcRenderer.invoke("demo:save-file", path, content);
  },
  saveFileAs(content: string) {
    return ipcRenderer.invoke("demo:save-file-as", content);
  },
  vault: vaultBridge,
  llmWiki: {
    saveSource(input) {
      return ipcRenderer.invoke("llm-wiki:save-source", input);
    },
    getStatus() {
      return ipcRenderer.invoke("llm-wiki:get-status");
    },
    getDocStatuses() {
      return ipcRenderer.invoke("llm-wiki:get-doc-statuses");
    },
    submitDoc(input) {
      return ipcRenderer.invoke("llm-wiki:submit-doc", input);
    },
    submitAllDirty() {
      return ipcRenderer.invoke("llm-wiki:submit-all-dirty");
    },
    retryFailed() {
      return ipcRenderer.invoke("llm-wiki:retry-failed");
    },
    getSubmitMode() {
      return ipcRenderer.invoke("llm-wiki:get-submit-mode");
    },
    setSubmitMode(mode) {
      return ipcRenderer.invoke("llm-wiki:set-submit-mode", mode);
    },
    getConfigStatus() {
      return ipcRenderer.invoke("llm-wiki:get-config-status");
    },
    saveConfig(input) {
      return ipcRenderer.invoke("llm-wiki:save-config", input);
    },
    ask(input) {
      return ipcRenderer.invoke("llm-wiki:ask", input);
    },
    openSchema(input) {
      return ipcRenderer.invoke("llm-wiki:open-schema", input);
    },
    onStatus(cb) {
      const listener = (_event: Electron.IpcRendererEvent, status: LLMWikiStatus) => cb(status);
      ipcRenderer.on("llm-wiki:status", listener);
      return () => {
        ipcRenderer.off("llm-wiki:status", listener);
      };
    },
    onDocStatus(cb) {
      const listener = (_event: Electron.IpcRendererEvent, payload: LLMWikiDocStatusPayload) => cb(payload);
      ipcRenderer.on("llm-wiki:doc-status", listener);
      return () => {
        ipcRenderer.off("llm-wiki:doc-status", listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("nexusDemo", bridge);
