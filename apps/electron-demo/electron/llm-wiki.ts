import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile as writeFsFile } from "node:fs/promises";
import path from "node:path";

export type LLMWikiPathKind = "raw" | "wiki" | "external";
export type LLMWikiStatusState = "queued" | "running" | "succeeded" | "failed";
export type LLMWikiProvider = "fixture" | "deepseek";
export type LLMWikiSubmitMode = "manual" | "auto";
export type LLMWikiDocumentStatusState = "dirty" | "queued" | "submitting" | "parsed" | "failed";

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

export interface LLMWikiProjectIssue {
  code: string;
  path: string;
  message: string;
}

export interface LLMWikiStateFile {
  version: 1;
  mode: LLMWikiSubmitMode;
  documents: Record<string, LLMWikiDocumentStatus>;
  projectIssues: LLMWikiProjectIssue[];
}

export interface LLMWikiStatus {
  state: LLMWikiStatusState;
  projectPath: string;
  message?: string;
  result?: LLMWikiCommandResult;
}

export interface LLMWikiCommandResult {
  ok: boolean;
  operation: string;
  written?: string[];
  issues?: Array<Record<string, unknown>>;
  error?: string;
}

export interface LLMWikiIngestFileResult extends LLMWikiCommandResult {
  operation: "ingest-file";
  raw: string;
  pages: string[];
  events: string[];
  usage?: Record<string, unknown>;
}

export interface LLMWikiConfigInput {
  provider: LLMWikiProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface LLMWikiConfigStatus {
  provider: LLMWikiProvider;
  model: string;
  baseUrl: string;
  apiKeyConfigured: boolean;
  envPath: string;
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

export interface LLMWikiSaveSourceInput {
  content: string;
  currentPath?: string | null;
}

export interface LLMWikiSaveSourceResult {
  projectPath: string;
  savedPath: string;
  pathKind: LLMWikiPathKind;
  queued: boolean;
}

export interface LLMWikiPreparedSaveSource {
  targetPath: string;
  pathKind: LLMWikiPathKind;
  queued: boolean;
}

export interface LLMWikiSaveSourceDeps {
  mkdir(path: string, options: { recursive: true }): Promise<unknown> | unknown;
  activateVault(vaultPath: string): Promise<unknown> | unknown;
  writeFile(path: string, content: string, encoding: "utf-8"): Promise<unknown> | unknown;
  pathExists?(path: string): Promise<boolean> | boolean;
  enqueueCompile(projectPath: string): void;
  markDirty?(projectPath: string, rawPath: string, content: string): Promise<boolean> | boolean;
  enqueueDocument?(projectPath: string, rawPath: string): void;
  shouldAutoSubmit?(projectPath: string): Promise<boolean> | boolean;
}

export interface LLMWikiQueueOptions {
  debounceMs: number;
  runner(projectPath: string): Promise<LLMWikiCommandResult>;
  emit(status: LLMWikiStatus): void;
}

export interface LLMWikiDocumentTask {
  rawPath: string;
  contentHash: string;
}

export interface LLMWikiDocumentQueueOptions {
  concurrency: number;
  loadTask(rawPath: string): Promise<LLMWikiDocumentTask>;
  runner(task: LLMWikiDocumentTask): Promise<LLMWikiIngestFileResult>;
  complete(
    rawPath: string,
    expectedHash: string,
    result: LLMWikiIngestFileResult
  ): Promise<LLMWikiDocumentStatus | null>;
  fail(rawPath: string, expectedHash: string, error: string): Promise<LLMWikiDocumentStatus | null>;
  emit(rawPath: string, status: LLMWikiDocumentStatus): void;
}

export interface PythonRunOptions {
  pythonCommand: string;
  scriptPath: string;
  args: string[];
  timeoutMs: number;
  maxStdoutBytes: number;
  cwd?: string;
  allowCommandFailure?: boolean;
}

const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
const MAX_PROJECT_RELATIVE_PATH_LENGTH = 512;
const CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARS_GLOBAL_PATTERN = /[\u0000-\u001f\u007f]/g;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
const EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const KNOWN_ENV_KEYS = new Set([
  "LLM_WIKI_PROVIDER",
  "LLM_WIKI_PYTHON",
  "LLM_WIKI_TIMEOUT_MS",
  "LLM_WIKI_DEBOUNCE_MS",
  "LLM_WIKI_MAX_STDOUT_BYTES",
  "LLM_WIKI_DEEPSEEK_BASE_URL",
  "LLM_WIKI_DEEPSEEK_MODEL",
  "DEEPSEEK_API_KEY",
] as const);

const SERIALIZED_ENV_KEYS = [
  "LLM_WIKI_PROVIDER",
  "LLM_WIKI_PYTHON",
  "LLM_WIKI_TIMEOUT_MS",
  "LLM_WIKI_DEBOUNCE_MS",
  "LLM_WIKI_MAX_STDOUT_BYTES",
  "LLM_WIKI_DEEPSEEK_BASE_URL",
  "LLM_WIKI_DEEPSEEK_MODEL",
  "DEEPSEEK_API_KEY",
] as const;

export type LLMWikiEnv = Partial<Record<(typeof SERIALIZED_ENV_KEYS)[number], string>>;

export function resolveLLMWikiProjectRoot(activeVault: string | null, documentsPath: string): string {
  return path.resolve(activeVault ?? path.join(documentsPath, "Nexus LLM Wiki"));
}

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export async function readLLMWikiEnv(sidecarDir: string): Promise<LLMWikiEnv> {
  const envPath = path.join(sidecarDir, ".env");
  if (!existsSync(envPath)) return {};

  const result: LLMWikiEnv = {};
  const content = await readFile(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.trim() as keyof LLMWikiEnv;
    if (!KNOWN_ENV_KEYS.has(key)) continue;
    result[key] = stripEnvQuotes(rest.join("=").trim());
  }
  return result;
}

function stripEnvQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function sanitizeEnvValue(value: string): string {
  return value.split(/\r|\n/, 1)[0].replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

export function serializeLLMWikiEnv(values: LLMWikiEnv): string {
  return `${SERIALIZED_ENV_KEYS.map((key) => `${key}=${sanitizeEnvValue(values[key] ?? "")}`).join("\n")}\n`;
}

export async function writeLLMWikiConfig(
  sidecarDir: string,
  input: LLMWikiConfigInput
): Promise<LLMWikiConfigStatus> {
  const previous = await readLLMWikiEnv(sidecarDir);
  const apiKey = input.apiKey?.trim() ? input.apiKey : previous.DEEPSEEK_API_KEY ?? "";
  const provider: LLMWikiProvider = input.provider === "deepseek" ? "deepseek" : "fixture";
  const values: LLMWikiEnv = {
    LLM_WIKI_PROVIDER: sanitizeEnvValue(provider),
    LLM_WIKI_PYTHON: sanitizeEnvValue(previous.LLM_WIKI_PYTHON || "python"),
    LLM_WIKI_TIMEOUT_MS: sanitizeEnvValue(previous.LLM_WIKI_TIMEOUT_MS || "120000"),
    LLM_WIKI_DEBOUNCE_MS: sanitizeEnvValue(previous.LLM_WIKI_DEBOUNCE_MS || "800"),
    LLM_WIKI_MAX_STDOUT_BYTES: sanitizeEnvValue(previous.LLM_WIKI_MAX_STDOUT_BYTES || "1048576"),
    LLM_WIKI_DEEPSEEK_BASE_URL: sanitizeEnvValue(
      input.baseUrl?.trim() || previous.LLM_WIKI_DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL
    ),
    LLM_WIKI_DEEPSEEK_MODEL: sanitizeEnvValue(
      input.model?.trim() || previous.LLM_WIKI_DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL
    ),
    DEEPSEEK_API_KEY: sanitizeEnvValue(apiKey),
  };
  await writeFsFile(path.join(sidecarDir, ".env"), serializeLLMWikiEnv(values), "utf-8");
  return getLLMWikiConfigStatus(sidecarDir);
}

export async function getLLMWikiConfigStatus(sidecarDir: string): Promise<LLMWikiConfigStatus> {
  const env = await readLLMWikiEnv(sidecarDir);
  return {
    provider: env.LLM_WIKI_PROVIDER === "deepseek" ? "deepseek" : "fixture",
    model: env.LLM_WIKI_DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
    baseUrl: env.LLM_WIKI_DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
    apiKeyConfigured: Boolean(env.DEEPSEEK_API_KEY?.trim()),
    envPath: path.join(sidecarDir, ".env"),
  };
}

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!Number.isInteger(fallback) || fallback <= 0) {
    throw new Error(`Invalid positive integer fallback: ${fallback}`);
  }
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function isInsidePath(root: string, target: string): boolean {
  const base = path.resolve(root);
  const candidate = path.resolve(target);
  const rel = path.relative(base, candidate);
  return rel === "" || rel === "." || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function classifyProjectPath(filePath: string | null | undefined, projectPath: string): LLMWikiPathKind {
  if (!filePath || !isInsidePath(projectPath, filePath)) return "external";
  const rel = path.relative(path.resolve(projectPath), path.resolve(filePath)).replace(/\\/g, "/");
  if (rel === "raw" || rel.startsWith("raw/")) return "raw";
  if (rel === "wiki" || rel.startsWith("wiki/")) return "wiki";
  return "external";
}

export function sanitizeRawFileName(input: string): string {
  const normalized = input
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/[:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const withoutLeadingDots = normalized.replace(/^[.\-\s]+/, "");
  const parsed = path.parse(withoutLeadingDots || "untitled");
  const stem = (parsed.name || parsed.base || "untitled").replace(/[.\-\s]+$/g, "") || "untitled";
  return `${stem}.md`;
}

export function deriveRawFileName(sourcePath: string | null | undefined, content: string): string {
  const heading = content.match(/^\s*#\s+(.+?)\s*$/m)?.[1];
  if (heading) return sanitizeRawFileName(heading);
  if (sourcePath) return sanitizeRawFileName(path.basename(sourcePath));
  return "untitled.md";
}

export function rawTargetPath(projectPath: string, sourcePath: string | null | undefined, content: string): string {
  const rawPath = path.join(projectPath, "raw");
  const target = path.join(rawPath, deriveRawFileName(sourcePath, content));
  if (!isInsidePath(rawPath, target)) {
    throw new Error(`Raw target escapes raw directory: ${target}`);
  }
  return target;
}

async function nextAvailableRawPath(
  initialPath: string,
  pathExists: (path: string) => Promise<boolean> | boolean = existsSync
): Promise<string> {
  if (!(await pathExists(initialPath))) return initialPath;

  const parsed = path.parse(initialPath);
  const extension = parsed.ext || ".md";
  const stem = parsed.name || "untitled";
  for (let suffix = 1; suffix < 10000; suffix += 1) {
    const candidate = path.join(parsed.dir, `${stem}-${suffix}${extension}`);
    if (!(await pathExists(candidate))) return candidate;
  }
  throw new Error(`Unable to allocate a non-conflicting raw file name for ${initialPath}`);
}

export function prepareSaveSource(input: {
  projectPath: string;
  currentPath?: string | null;
  content: string;
}): LLMWikiPreparedSaveSource {
  const projectPath = path.resolve(input.projectPath);
  const rawPath = path.join(projectPath, "raw");
  const wikiPath = path.join(projectPath, "wiki");

  if (input.currentPath && hasLexicalRawEscape(projectPath, input.currentPath)) {
    throw new Error(`Path escapes raw directory: ${input.currentPath}`);
  }

  const pathKind = classifyProjectPath(input.currentPath, projectPath);
  if (pathKind === "wiki") {
    if (!input.currentPath) throw new Error("Wiki save requires a file path");
    const targetPath = path.resolve(input.currentPath);
    if (!isInsidePath(wikiPath, targetPath)) {
      throw new Error(`Path escapes wiki directory: ${input.currentPath}`);
    }
    return { targetPath, pathKind, queued: false };
  }

  if (pathKind === "raw") {
    if (!input.currentPath) throw new Error("Raw save requires a file path");
    const targetPath = path.resolve(input.currentPath);
    if (!isInsidePath(rawPath, targetPath)) {
      throw new Error(`Path escapes raw directory: ${input.currentPath}`);
    }
    return { targetPath, pathKind, queued: true };
  }

  const targetPath = rawTargetPath(projectPath, input.currentPath, input.content);
  return { targetPath, pathKind, queued: true };
}

function hasLexicalRawEscape(projectPath: string, currentPath: string): boolean {
  const rawPrefix = path.join(path.resolve(projectPath), "raw").replace(/\\/g, "/");
  const candidate = currentPath.replace(/\\/g, "/");
  if (!candidate.startsWith(`${rawPrefix}/`)) return false;
  return candidate.slice(rawPrefix.length + 1).split("/").includes("..");
}

export async function saveLLMWikiSource(
  input: {
    projectPath: string;
    currentPath?: string | null;
    content: string;
  },
  deps: LLMWikiSaveSourceDeps
): Promise<LLMWikiSaveSourceResult> {
  const projectPath = path.resolve(input.projectPath);
  const content = input.content ?? "";
  const prepared = prepareSaveSource({ projectPath, currentPath: input.currentPath, content });
  let targetPath = prepared.targetPath;
  if (!isInsidePath(projectPath, targetPath)) {
    throw new Error(`Path escapes LLM Wiki project: ${targetPath}`);
  }

  await deps.mkdir(path.join(projectPath, ".nexus"), { recursive: true });
  await deps.mkdir(path.join(projectPath, "raw"), { recursive: true });
  await deps.mkdir(path.join(projectPath, "wiki"), { recursive: true });
  await deps.activateVault(projectPath);
  if (prepared.pathKind === "external") {
    targetPath = await nextAvailableRawPath(targetPath, deps.pathExists);
  }
  if (!isInsidePath(projectPath, targetPath)) {
    throw new Error(`Path escapes LLM Wiki project: ${targetPath}`);
  }
  await deps.mkdir(path.dirname(targetPath), { recursive: true });
  await deps.writeFile(targetPath, content, "utf-8");

  if (prepared.queued) {
    const rawRel = path.relative(projectPath, targetPath).replace(/\\/g, "/");
    const changed = await deps.markDirty?.(projectPath, rawRel, content);
    const autoSubmit = await deps.shouldAutoSubmit?.(projectPath);
    if (autoSubmit && changed !== false) {
      deps.enqueueDocument?.(projectPath, rawRel);
    }
  }

  if (prepared.queued && !deps.markDirty) {
    deps.enqueueCompile(projectPath);
  }

  return {
    projectPath,
    savedPath: targetPath,
    pathKind: prepared.pathKind,
    queued: prepared.queued,
  };
}

function emptyLLMWikiState(): LLMWikiStateFile {
  return { version: 1, mode: "manual", documents: {}, projectIssues: [] };
}

export function normalizeRawDocumentPath(rawPath: string): string {
  const normalized = rawPath.trim();
  if (
    rawPath !== normalized ||
    normalized.includes("\\") ||
    CONTROL_CHARS_PATTERN.test(normalized) ||
    !normalized.startsWith("raw/") ||
    normalized === "raw/" ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.length > MAX_PROJECT_RELATIVE_PATH_LENGTH ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid raw document path: ${rawPath}`);
  }
  return normalized;
}

function sanitizeStatusError(message: string): string {
  return sanitizeCommandText(message).replace(CONTROL_CHARS_GLOBAL_PATTERN, " ").slice(0, 1000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isDocumentStatus(value: unknown): value is LLMWikiDocumentStatusState {
  return (
    value === "dirty" ||
    value === "queued" ||
    value === "submitting" ||
    value === "parsed" ||
    value === "failed"
  );
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

function hasErrorCode(value: unknown, code: string): boolean {
  return isRecord(value) && value.code === code;
}

function normalizeGeneratedWikiPath(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid generated wiki path: expected string");
  const normalized = value.trim();
  if (
    value !== normalized ||
    normalized.includes("\\") ||
    CONTROL_CHARS_PATTERN.test(normalized) ||
    !normalized.startsWith("wiki/") ||
    normalized === "wiki/" ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.length > MAX_PROJECT_RELATIVE_PATH_LENGTH ||
    normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid generated wiki path: ${value}`);
  }
  return normalized;
}

function normalizeGeneratedWikiPaths(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid generated wiki paths: expected array");
  return value.map((entry) => normalizeGeneratedWikiPath(entry));
}

function normalizeIngestEventSlug(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid ingest event: expected string");
  if (
    value.length === 0 ||
    CONTROL_CHARS_PATTERN.test(value) ||
    !EVENT_SLUG_PATTERN.test(value)
  ) {
    throw new Error(`Invalid ingest event: ${value}`);
  }
  return value;
}

function normalizeIngestEventSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Invalid ingest events: expected array");
  return value.map((entry) => normalizeIngestEventSlug(entry));
}

function normalizeLLMWikiDocumentStatus(value: unknown): LLMWikiDocumentStatus | null {
  if (!isRecord(value)) return null;
  if (!isDocumentStatus(value.status)) return null;
  if (!isSha256Hex(value.contentHash)) return null;
  if (typeof value.updatedAt !== "string") return null;
  if (!isNullableString(value.submittedAt)) return null;
  if (!isNullableString(value.completedAt)) return null;
  if (!isNullableString(value.error)) return null;
  if (!isStringArray(value.generated)) return null;
  if (!isStringArray(value.events)) return null;
  try {
    normalizeGeneratedWikiPaths(value.generated);
    normalizeIngestEventSlugs(value.events);
  } catch {
    return null;
  }

  return {
    status: value.status,
    contentHash: value.contentHash,
    updatedAt: value.updatedAt,
    submittedAt: value.submittedAt,
    completedAt: value.completedAt,
    error: value.error,
    generated: value.generated,
    events: value.events,
  };
}

function normalizeLLMWikiDocuments(value: unknown): Record<string, LLMWikiDocumentStatus> {
  if (!isRecord(value)) return {};
  const documents: Record<string, LLMWikiDocumentStatus> = {};
  for (const [rawPath, rawStatus] of Object.entries(value)) {
    let normalizedPath: string;
    try {
      normalizedPath = normalizeRawDocumentPath(rawPath);
    } catch {
      continue;
    }
    const status = normalizeLLMWikiDocumentStatus(rawStatus);
    if (status) documents[normalizedPath] = status;
  }
  return documents;
}

export function normalizeProjectIssues(value: unknown): LLMWikiProjectIssue[] {
  if (!Array.isArray(value)) return [];
  const issues: LLMWikiProjectIssue[] = [];
  for (const issue of value) {
    if (
      isRecord(issue) &&
      typeof issue.code === "string" &&
      typeof issue.path === "string" &&
      typeof issue.message === "string"
    ) {
      issues.push({ code: issue.code, path: issue.path, message: issue.message });
    }
  }
  return issues;
}

export class LLMWikiStateStore {
  private static readonly mutationQueues = new Map<string, Promise<unknown>>();

  private readonly statePath: string;

  constructor(private readonly projectPath: string) {
    this.statePath = path.join(projectPath, ".nexus", "llm-wiki-state.json");
  }

  async read(): Promise<LLMWikiStateFile> {
    let content: string;
    try {
      content = await readFile(this.statePath, "utf-8");
    } catch (err) {
      if (hasErrorCode(err, "ENOENT")) return emptyLLMWikiState();
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      return emptyLLMWikiState();
    }
    if (!isRecord(parsed)) return emptyLLMWikiState();
    return {
      version: 1,
      mode: parsed.mode === "auto" ? "auto" : "manual",
      documents: normalizeLLMWikiDocuments(parsed.documents),
      projectIssues: normalizeProjectIssues(parsed.projectIssues),
    };
  }

  private async write(state: LLMWikiStateFile): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tmpPath = path.join(
      path.dirname(this.statePath),
      `.${path.basename(this.statePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    );
    await writeFsFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    await rename(tmpPath, this.statePath);
  }

  private async mutate<T>(mutation: () => Promise<T>): Promise<T> {
    const previous = LLMWikiStateStore.mutationQueues.get(this.statePath) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(mutation);
    const queued = current.catch(() => undefined);
    LLMWikiStateStore.mutationQueues.set(this.statePath, queued);
    try {
      return await current;
    } finally {
      if (LLMWikiStateStore.mutationQueues.get(this.statePath) === queued) {
        LLMWikiStateStore.mutationQueues.delete(this.statePath);
      }
    }
  }

  async setMode(mode: LLMWikiSubmitMode): Promise<LLMWikiStateFile> {
    return this.mutate(async () => {
      const state = await this.read();
      state.mode = mode === "auto" ? "auto" : "manual";
      await this.write(state);
      return state;
    });
  }

  async markDirty(rawPath: string, content: string, now = new Date()): Promise<boolean> {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const hash = computeContentHash(content);
      const state = await this.read();
      const existing = state.documents[raw];
      if (existing?.contentHash === hash) return false;

      state.documents[raw] = {
        status: "dirty",
        contentHash: hash,
        updatedAt: now.toISOString(),
        submittedAt: null,
        completedAt: null,
        error: null,
        generated: [],
        events: [],
      };
      await this.write(state);
      return true;
    });
  }

  async enqueue(rawPath: string, now = new Date()): Promise<LLMWikiDocumentStatus> {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const state = await this.read();
      const existing = state.documents[raw];
      if (!existing) throw new Error(`Cannot enqueue unknown raw document: ${raw}`);
      if (existing.status === "queued" || existing.status === "submitting") return existing;
      if (existing.status !== "dirty" && existing.status !== "failed") return existing;
      const next = { ...existing, status: "queued" as const, submittedAt: now.toISOString(), error: null };
      state.documents[raw] = next;
      await this.write(state);
      return next;
    });
  }

  async start(rawPath: string, now = new Date()): Promise<LLMWikiDocumentStatus> {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const state = await this.read();
      const existing = state.documents[raw];
      if (!existing) throw new Error(`Cannot start unknown raw document: ${raw}`);
      const next = {
        ...existing,
        status: "submitting" as const,
        submittedAt: existing.submittedAt ?? now.toISOString(),
      };
      state.documents[raw] = next;
      await this.write(state);
      return next;
    });
  }

  async complete(
    rawPath: string,
    expectedHash: string,
    result: Pick<LLMWikiIngestFileResult, "written" | "pages" | "events">,
    now = new Date()
  ): Promise<LLMWikiDocumentStatus | null> {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const state = await this.read();
      const existing = state.documents[raw];
      if (!existing || existing.contentHash !== expectedHash) return null;
      const generated = normalizeGeneratedWikiPaths(result.written);
      const events = normalizeIngestEventSlugs(result.events);
      const next = {
        ...existing,
        status: "parsed" as const,
        completedAt: now.toISOString(),
        error: null,
        generated,
        events,
      };
      state.documents[raw] = next;
      await this.write(state);
      return next;
    });
  }

  async fail(
    rawPath: string,
    expectedHash: string,
    error: string,
    now = new Date()
  ): Promise<LLMWikiDocumentStatus | null> {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const state = await this.read();
      const existing = state.documents[raw];
      if (!existing || existing.contentHash !== expectedHash) return null;
      const next = {
        ...existing,
        status: "failed" as const,
        completedAt: now.toISOString(),
        error: sanitizeStatusError(error),
      };
      state.documents[raw] = next;
      await this.write(state);
      return next;
    });
  }

  async setProjectIssues(issues: LLMWikiProjectIssue[]): Promise<LLMWikiStateFile> {
    return this.mutate(async () => {
      const state = await this.read();
      state.projectIssues = normalizeProjectIssues(issues);
      await this.write(state);
      return state;
    });
  }
}

export class LLMWikiDocumentQueue {
  private readonly queued: string[] = [];
  private readonly queuedSet = new Set<string>();
  private readonly running = new Set<string>();
  private readonly rerunSet = new Set<string>();
  private pumpScheduled = false;

  constructor(private readonly options: LLMWikiDocumentQueueOptions) {
    if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
      throw new Error("LLM Wiki document queue concurrency must be positive");
    }
  }

  enqueue(rawPath: string): void {
    const raw = normalizeRawDocumentPath(rawPath);
    if (this.queuedSet.has(raw)) return;
    if (this.running.has(raw)) {
      this.rerunSet.add(raw);
      return;
    }
    this.queue(raw);
    this.schedulePump();
  }

  private queue(rawPath: string): void {
    if (this.queuedSet.has(rawPath)) return;
    this.queued.push(rawPath);
    this.queuedSet.add(rawPath);
  }

  private schedulePump(): void {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    setTimeout(() => {
      this.pumpScheduled = false;
      void this.pump();
    }, 0);
  }

  private async pump(): Promise<void> {
    while (this.running.size < this.options.concurrency && this.queued.length > 0) {
      const rawPath = this.queued.shift();
      if (!rawPath) return;
      this.queuedSet.delete(rawPath);
      if (this.running.has(rawPath)) {
        this.rerunSet.add(rawPath);
        continue;
      }
      this.running.add(rawPath);
      void this.runOne(rawPath);
    }
  }

  private async runOne(rawPath: string): Promise<void> {
    let task: LLMWikiDocumentTask | null = null;
    try {
      task = await this.options.loadTask(rawPath);
      const result = await this.options.runner(task);
      const completed = await this.options.complete(rawPath, task.contentHash, result);
      if (completed) this.safeEmit(rawPath, completed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (task) await this.failTask(rawPath, task.contentHash, message);
    } finally {
      this.running.delete(rawPath);
      if (this.rerunSet.delete(rawPath)) {
        this.queue(rawPath);
      }
      void this.pump();
    }
  }

  private async failTask(rawPath: string, expectedHash: string, message: string): Promise<void> {
    try {
      const failed = await this.options.fail(rawPath, expectedHash, message);
      if (failed) this.safeEmit(rawPath, failed);
    } catch {
      // Status persistence failures must not break queue progress.
    }
  }

  private safeEmit(rawPath: string, status: LLMWikiDocumentStatus): void {
    try {
      this.options.emit(rawPath, status);
    } catch {
      // Renderer/status callbacks are best-effort and outside queue correctness.
    }
  }

  async waitForIdle(): Promise<void> {
    while (this.queued.length > 0 || this.running.size > 0 || this.rerunSet.size > 0 || this.pumpScheduled) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

export class LLMWikiCompileQueue {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private pendingProject: string | null = null;

  constructor(private readonly options: LLMWikiQueueOptions) {}

  enqueue(projectPath: string): void {
    this.safeEmit({ state: "queued", projectPath });
    if (this.running) {
      this.pendingProject = projectPath;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runSafely(projectPath);
    }, this.options.debounceMs);
  }

  private runSafely(projectPath: string): void {
    void this.run(projectPath).catch((err) => {
      this.running = false;
      const message = err instanceof Error ? err.message : String(err);
      this.safeEmit({ state: "failed", projectPath, message });
      if (this.pendingProject) {
        const next = this.pendingProject;
        this.pendingProject = null;
        this.enqueue(next);
      }
    });
  }

  private async run(projectPath: string): Promise<void> {
    if (this.running) {
      this.pendingProject = projectPath;
      return;
    }
    this.running = true;
    this.safeEmit({ state: "running", projectPath });
    try {
      const result = await this.options.runner(projectPath);
      this.running = false;
      if (this.pendingProject) {
        const next = this.pendingProject;
        this.pendingProject = null;
        this.runSafely(next);
        return;
      }
      this.safeEmit({ state: "succeeded", projectPath, result });
    } catch (err) {
      this.running = false;
      const message = err instanceof Error ? err.message : String(err);
      this.safeEmit({ state: "failed", projectPath, message });
      if (this.pendingProject) {
        const next = this.pendingProject;
        this.pendingProject = null;
        this.enqueue(next);
      }
    }
  }

  private safeEmit(status: LLMWikiStatus): void {
    try {
      this.options.emit(status);
    } catch {
      // Status callbacks are best-effort and must not break queue progress.
    }
  }

  async waitForIdleTick(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async waitForIdle(): Promise<void> {
    while (this.running || this.timer || this.pendingProject) {
      await this.waitForIdleTick();
    }
  }
}

export function runPythonJson(options: PythonRunOptions): Promise<LLMWikiCommandResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (env.LLM_WIKI_ALLOW_ANTHROPIC_API_KEY !== "1") {
      delete env.ANTHROPIC_API_KEY;
    }
    env.PYTHONIOENCODING = "utf-8";
    env.PYTHONUTF8 = "1";
    const child = spawn(options.pythonCommand, [options.scriptPath, ...options.args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env,
    });
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let stderrBytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`LLM Wiki command timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return;
      stdout += chunk.toString("utf-8");
      stdoutBytes += chunk.length;
      if (stdoutBytes > options.maxStdoutBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(new Error("LLM Wiki command exceeded stdout limit"));
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (settled) return;
      stderr += chunk.toString("utf-8");
      stderrBytes += chunk.length;
      if (stderrBytes > options.maxStdoutBytes && !settled) {
        settled = true;
        clearTimeout(timer);
        child.kill();
        reject(new Error("LLM Wiki command exceeded stderr limit"));
      }
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout.trim()) as unknown;
      } catch (err) {
        reject(new Error(`LLM Wiki command returned malformed JSON: ${sanitizeCommandText(stderr || stdout || String(err))}`));
        return;
      }
      if (!isLLMWikiCommandResult(parsed)) {
        reject(new Error("LLM Wiki command returned malformed protocol payload"));
        return;
      }
      if ((code !== 0 || !parsed.ok) && !options.allowCommandFailure) {
        reject(new Error(formatCommandFailure(parsed, code, stderr)));
        return;
      }
      resolve(parsed);
    });
  });
}

function isLLMWikiCommandResult(value: unknown): value is LLMWikiCommandResult {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as LLMWikiCommandResult).ok === "boolean" &&
    typeof (value as LLMWikiCommandResult).operation === "string"
  );
}

function formatCommandFailure(result: LLMWikiCommandResult, code: number | null, stderr: string): string {
  const parts = [`LLM Wiki ${result.operation} failed`];
  if (code !== 0) parts.push(`exit code ${code ?? "unknown"}`);
  if (result.error) parts.push(sanitizeCommandText(result.error));
  const issueSummary = formatCommandIssues(result.issues);
  if (issueSummary) parts.push(issueSummary);
  const cleanStderr = sanitizeCommandText(stderr.trim());
  if (cleanStderr) parts.push(`stderr: ${cleanStderr}`);
  return parts.join(": ");
}

function formatCommandIssues(issues: Array<Record<string, unknown>> | undefined): string {
  if (!Array.isArray(issues)) return "";
  const formatted = issues
    .slice(0, 5)
    .map((issue) => {
      if (!isRecord(issue)) return "";
      const code = typeof issue.code === "string" ? issue.code : "";
      const issuePath = typeof issue.path === "string" ? issue.path : "";
      const message = typeof issue.message === "string" ? issue.message : "";
      return [code, issuePath, message].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  if (formatted.length === 0) return "";
  return sanitizeCommandText(`issues: ${formatted.join("; ")}`);
}

function sanitizeCommandText(value: string): string {
  return value
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*)=([^\s]+)/gi, "$1=[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-key]")
    .slice(0, 2000);
}

export async function runSidecarCommand(
  sidecarDir: string,
  command: "ensure" | "ingest" | "lint",
  projectPath: string,
  options?: Partial<Pick<PythonRunOptions, "pythonCommand" | "timeoutMs" | "maxStdoutBytes">> & { provider?: string }
): Promise<LLMWikiCommandResult> {
  const scriptPath = path.join(sidecarDir, "llm_wiki.py");
  const args = [command, "--project", projectPath];
  if (command === "ingest") args.push("--provider", options?.provider ?? "fixture");
  return runPythonJson({
    pythonCommand: options?.pythonCommand ?? "python",
    scriptPath,
    args,
    timeoutMs: options?.timeoutMs ?? 120000,
    maxStdoutBytes: options?.maxStdoutBytes ?? 1024 * 1024,
    cwd: sidecarDir,
  });
}

export async function runSidecarCompile(
  sidecarDir: string,
  projectPath: string,
  options?: Partial<Pick<PythonRunOptions, "pythonCommand" | "timeoutMs" | "maxStdoutBytes">> & { provider?: string }
): Promise<LLMWikiCommandResult> {
  await runSidecarCommand(sidecarDir, "ensure", projectPath, options);
  const ingest = await runSidecarCommand(sidecarDir, "ingest", projectPath, options);
  const lint = await runSidecarCommand(sidecarDir, "lint", projectPath, options);
  return {
    ok: true,
    operation: "compile",
    written: ingest.written ?? [],
    issues: lint.issues ?? [],
  };
}

function isSafeGeneratedWikiPath(value: unknown): value is string {
  try {
    normalizeGeneratedWikiPath(value);
    return true;
  } catch {
    return false;
  }
}

function isSafeIngestSlug(value: unknown): value is string {
  try {
    normalizeIngestEventSlug(value);
    return true;
  } catch {
    return false;
  }
}

function isLLMWikiIngestFileResult(
  value: LLMWikiCommandResult,
  expectedRawPath: string
): value is LLMWikiIngestFileResult {
  const candidate = value as Partial<LLMWikiIngestFileResult>;
  return (
    candidate.operation === "ingest-file" &&
    candidate.raw === expectedRawPath &&
    Array.isArray(candidate.written) &&
    candidate.written.every(isSafeGeneratedWikiPath) &&
    Array.isArray(candidate.pages) &&
    candidate.pages.every(isSafeIngestSlug) &&
    Array.isArray(candidate.events) &&
    candidate.events.every(isSafeIngestSlug)
  );
}

export async function runSidecarIngestFile(
  sidecarDir: string,
  projectPath: string,
  rawPath: string,
  options?: Partial<Pick<PythonRunOptions, "pythonCommand" | "timeoutMs" | "maxStdoutBytes">> & { provider?: string }
): Promise<LLMWikiIngestFileResult> {
  const scriptPath = path.join(sidecarDir, "llm_wiki.py");
  const normalizedRawPath = normalizeRawDocumentPath(rawPath);
  const result = await runPythonJson({
    pythonCommand: options?.pythonCommand ?? "python",
    scriptPath,
    args: [
      "ingest-file",
      "--project",
      projectPath,
      "--raw",
      normalizedRawPath,
      "--provider",
      options?.provider ?? "fixture",
    ],
    timeoutMs: options?.timeoutMs ?? 120000,
    maxStdoutBytes: options?.maxStdoutBytes ?? 1024 * 1024,
    cwd: sidecarDir,
    allowCommandFailure: true,
  });
  if (!isLLMWikiIngestFileResult(result, normalizedRawPath)) {
    if (!result.ok) {
      throw new Error(formatCommandFailure(result, null, ""));
    }
    throw new Error("LLM Wiki ingest-file returned malformed payload");
  }
  return result;
}

function isLLMWikiAskResult(value: LLMWikiCommandResult): value is LLMWikiAskResult {
  const candidate = value as Partial<LLMWikiAskResult>;
  return (
    candidate.operation === "query" &&
    typeof candidate.answer === "string" &&
    Array.isArray(candidate.citations) &&
    candidate.citations.every(
      (citation) =>
        typeof citation === "object" &&
        citation !== null &&
        !Array.isArray(citation) &&
        typeof citation.path === "string" &&
        (citation.quote === undefined || typeof citation.quote === "string")
    ) &&
    Array.isArray(candidate.read) &&
    candidate.read.every((entry) => typeof entry === "string") &&
    (candidate.usage === undefined ||
      (typeof candidate.usage === "object" && candidate.usage !== null && !Array.isArray(candidate.usage)))
  );
}

export async function runSidecarQuery(
  sidecarDir: string,
  projectPath: string,
  question: string,
  options?: Partial<Pick<PythonRunOptions, "pythonCommand" | "timeoutMs" | "maxStdoutBytes">> & {
    provider?: LLMWikiProvider;
  }
): Promise<LLMWikiAskResult> {
  if ((options?.provider ?? "fixture") !== "deepseek") {
    throw new Error("LLM Wiki Ask requires DeepSeek provider.");
  }
  const scriptPath = path.join(sidecarDir, "llm_wiki.py");
  const result = await runPythonJson({
    pythonCommand: options?.pythonCommand ?? "python",
    scriptPath,
    args: ["query", "--project", projectPath, "--question", question],
    timeoutMs: options?.timeoutMs ?? 120000,
    maxStdoutBytes: options?.maxStdoutBytes ?? 1024 * 1024,
    cwd: sidecarDir,
  });
  if (!isLLMWikiAskResult(result)) {
    throw new Error("LLM Wiki query returned malformed answer payload");
  }
  return result;
}
