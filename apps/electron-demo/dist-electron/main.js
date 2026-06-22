"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/main.ts
var main_exports = {};
module.exports = __toCommonJS(main_exports);
var import_electron = require("electron");
var import_promises2 = require("fs/promises");
var import_node_fs2 = require("fs");
var import_node_path2 = __toESM(require("path"));
var import_node_url = require("url");

// electron/llm-wiki.ts
var import_node_child_process = require("child_process");
var import_node_crypto = require("crypto");
var import_node_fs = require("fs");
var import_promises = require("fs/promises");
var import_node_path = __toESM(require("path"));
var DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
var DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-pro";
var MAX_PROJECT_RELATIVE_PATH_LENGTH = 512;
var CONTROL_CHARS_PATTERN = /[\u0000-\u001f\u007f]/;
var CONTROL_CHARS_GLOBAL_PATTERN = /[\u0000-\u001f\u007f]/g;
var SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;
var EVENT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
var KNOWN_ENV_KEYS = /* @__PURE__ */ new Set([
  "LLM_WIKI_PROVIDER",
  "LLM_WIKI_PYTHON",
  "LLM_WIKI_TIMEOUT_MS",
  "LLM_WIKI_DEBOUNCE_MS",
  "LLM_WIKI_MAX_STDOUT_BYTES",
  "LLM_WIKI_DEEPSEEK_BASE_URL",
  "LLM_WIKI_DEEPSEEK_MODEL",
  "DEEPSEEK_API_KEY"
]);
var SERIALIZED_ENV_KEYS = [
  "LLM_WIKI_PROVIDER",
  "LLM_WIKI_PYTHON",
  "LLM_WIKI_TIMEOUT_MS",
  "LLM_WIKI_DEBOUNCE_MS",
  "LLM_WIKI_MAX_STDOUT_BYTES",
  "LLM_WIKI_DEEPSEEK_BASE_URL",
  "LLM_WIKI_DEEPSEEK_MODEL",
  "DEEPSEEK_API_KEY"
];
function resolveLLMWikiProjectRoot(activeVault2, documentsPath) {
  return import_node_path.default.resolve(activeVault2 ?? import_node_path.default.join(documentsPath, "Nexus LLM Wiki"));
}
function computeContentHash(content) {
  return (0, import_node_crypto.createHash)("sha256").update(content, "utf8").digest("hex");
}
async function readLLMWikiEnv(sidecarDir) {
  const envPath = import_node_path.default.join(sidecarDir, ".env");
  if (!(0, import_node_fs.existsSync)(envPath)) return {};
  const result = {};
  const content = await (0, import_promises.readFile)(envPath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey.trim();
    if (!KNOWN_ENV_KEYS.has(key)) continue;
    result[key] = stripEnvQuotes(rest.join("=").trim());
  }
  return result;
}
function stripEnvQuotes(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === `"` && last === `"` || first === `'` && last === `'`) {
      return value.slice(1, -1);
    }
  }
  return value;
}
function sanitizeEnvValue(value) {
  return value.split(/\r|\n/, 1)[0].replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}
function serializeLLMWikiEnv(values) {
  return `${SERIALIZED_ENV_KEYS.map((key) => `${key}=${sanitizeEnvValue(values[key] ?? "")}`).join("\n")}
`;
}
async function writeLLMWikiConfig(sidecarDir, input) {
  const previous = await readLLMWikiEnv(sidecarDir);
  const apiKey = input.apiKey?.trim() ? input.apiKey : previous.DEEPSEEK_API_KEY ?? "";
  const provider = input.provider === "deepseek" ? "deepseek" : "fixture";
  const values = {
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
    DEEPSEEK_API_KEY: sanitizeEnvValue(apiKey)
  };
  await (0, import_promises.writeFile)(import_node_path.default.join(sidecarDir, ".env"), serializeLLMWikiEnv(values), "utf-8");
  return getLLMWikiConfigStatus(sidecarDir);
}
async function getLLMWikiConfigStatus(sidecarDir) {
  const env = await readLLMWikiEnv(sidecarDir);
  return {
    provider: env.LLM_WIKI_PROVIDER === "deepseek" ? "deepseek" : "fixture",
    model: env.LLM_WIKI_DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_MODEL,
    baseUrl: env.LLM_WIKI_DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL,
    apiKeyConfigured: Boolean(env.DEEPSEEK_API_KEY?.trim()),
    envPath: import_node_path.default.join(sidecarDir, ".env")
  };
}
function parsePositiveInteger(value, fallback) {
  if (!Number.isInteger(fallback) || fallback <= 0) {
    throw new Error(`Invalid positive integer fallback: ${fallback}`);
  }
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}
function isInsidePath(root, target) {
  const base = import_node_path.default.resolve(root);
  const candidate = import_node_path.default.resolve(target);
  const rel = import_node_path.default.relative(base, candidate);
  return rel === "" || rel === "." || !rel.startsWith("..") && !import_node_path.default.isAbsolute(rel);
}
function classifyProjectPath(filePath, projectPath) {
  if (!filePath || !isInsidePath(projectPath, filePath)) return "external";
  const rel = import_node_path.default.relative(import_node_path.default.resolve(projectPath), import_node_path.default.resolve(filePath)).replace(/\\/g, "/");
  if (rel === "raw" || rel.startsWith("raw/")) return "raw";
  if (rel === "wiki" || rel.startsWith("wiki/")) return "wiki";
  return "external";
}
function sanitizeRawFileName(input) {
  const normalized = input.replace(/[\u0000-\u001f]/g, "").replace(/[\\/]+/g, "-").replace(/[:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  const withoutLeadingDots = normalized.replace(/^[.\-\s]+/, "");
  const parsed = import_node_path.default.parse(withoutLeadingDots || "untitled");
  const stem = (parsed.name || parsed.base || "untitled").replace(/[.\-\s]+$/g, "") || "untitled";
  return `${stem}.md`;
}
function deriveRawFileName(sourcePath, content) {
  const heading = content.match(/^\s*#\s+(.+?)\s*$/m)?.[1];
  if (heading) return sanitizeRawFileName(heading);
  if (sourcePath) return sanitizeRawFileName(import_node_path.default.basename(sourcePath));
  return "untitled.md";
}
function rawTargetPath(projectPath, sourcePath, content) {
  const rawPath = import_node_path.default.join(projectPath, "raw");
  const target = import_node_path.default.join(rawPath, deriveRawFileName(sourcePath, content));
  if (!isInsidePath(rawPath, target)) {
    throw new Error(`Raw target escapes raw directory: ${target}`);
  }
  return target;
}
async function nextAvailableRawPath(initialPath, pathExists = import_node_fs.existsSync) {
  if (!await pathExists(initialPath)) return initialPath;
  const parsed = import_node_path.default.parse(initialPath);
  const extension = parsed.ext || ".md";
  const stem = parsed.name || "untitled";
  for (let suffix = 1; suffix < 1e4; suffix += 1) {
    const candidate = import_node_path.default.join(parsed.dir, `${stem}-${suffix}${extension}`);
    if (!await pathExists(candidate)) return candidate;
  }
  throw new Error(`Unable to allocate a non-conflicting raw file name for ${initialPath}`);
}
function prepareSaveSource(input) {
  const projectPath = import_node_path.default.resolve(input.projectPath);
  const rawPath = import_node_path.default.join(projectPath, "raw");
  const wikiPath = import_node_path.default.join(projectPath, "wiki");
  if (input.currentPath && hasLexicalRawEscape(projectPath, input.currentPath)) {
    throw new Error(`Path escapes raw directory: ${input.currentPath}`);
  }
  const pathKind = classifyProjectPath(input.currentPath, projectPath);
  if (pathKind === "wiki") {
    if (!input.currentPath) throw new Error("Wiki save requires a file path");
    const targetPath2 = import_node_path.default.resolve(input.currentPath);
    if (!isInsidePath(wikiPath, targetPath2)) {
      throw new Error(`Path escapes wiki directory: ${input.currentPath}`);
    }
    return { targetPath: targetPath2, pathKind, queued: false };
  }
  if (pathKind === "raw") {
    if (!input.currentPath) throw new Error("Raw save requires a file path");
    const targetPath2 = import_node_path.default.resolve(input.currentPath);
    if (!isInsidePath(rawPath, targetPath2)) {
      throw new Error(`Path escapes raw directory: ${input.currentPath}`);
    }
    return { targetPath: targetPath2, pathKind, queued: true };
  }
  const targetPath = rawTargetPath(projectPath, input.currentPath, input.content);
  return { targetPath, pathKind, queued: true };
}
function hasLexicalRawEscape(projectPath, currentPath) {
  const rawPrefix = import_node_path.default.join(import_node_path.default.resolve(projectPath), "raw").replace(/\\/g, "/");
  const candidate = currentPath.replace(/\\/g, "/");
  if (!candidate.startsWith(`${rawPrefix}/`)) return false;
  return candidate.slice(rawPrefix.length + 1).split("/").includes("..");
}
async function saveLLMWikiSource(input, deps) {
  const projectPath = import_node_path.default.resolve(input.projectPath);
  const content = input.content ?? "";
  const prepared = prepareSaveSource({ projectPath, currentPath: input.currentPath, content });
  let targetPath = prepared.targetPath;
  if (!isInsidePath(projectPath, targetPath)) {
    throw new Error(`Path escapes LLM Wiki project: ${targetPath}`);
  }
  await deps.mkdir(import_node_path.default.join(projectPath, ".nexus"), { recursive: true });
  await deps.mkdir(import_node_path.default.join(projectPath, "raw"), { recursive: true });
  await deps.mkdir(import_node_path.default.join(projectPath, "wiki"), { recursive: true });
  await deps.activateVault(projectPath);
  if (prepared.pathKind === "external") {
    targetPath = await nextAvailableRawPath(targetPath, deps.pathExists);
  }
  if (!isInsidePath(projectPath, targetPath)) {
    throw new Error(`Path escapes LLM Wiki project: ${targetPath}`);
  }
  await deps.mkdir(import_node_path.default.dirname(targetPath), { recursive: true });
  await deps.writeFile(targetPath, content, "utf-8");
  if (prepared.queued) {
    const rawRel = import_node_path.default.relative(projectPath, targetPath).replace(/\\/g, "/");
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
    queued: prepared.queued
  };
}
function emptyLLMWikiState() {
  return { version: 1, mode: "manual", documents: {}, projectIssues: [] };
}
function normalizeRawDocumentPath(rawPath) {
  const normalized = rawPath.trim();
  if (rawPath !== normalized || normalized.includes("\\") || CONTROL_CHARS_PATTERN.test(normalized) || !normalized.startsWith("raw/") || normalized === "raw/" || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.length > MAX_PROJECT_RELATIVE_PATH_LENGTH || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Invalid raw document path: ${rawPath}`);
  }
  return normalized;
}
function sanitizeStatusError(message) {
  return sanitizeCommandText(message).replace(CONTROL_CHARS_GLOBAL_PATTERN, " ").slice(0, 1e3);
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNullableString(value) {
  return typeof value === "string" || value === null;
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function isDocumentStatus(value) {
  return value === "dirty" || value === "queued" || value === "submitting" || value === "parsed" || value === "failed";
}
function isSha256Hex(value) {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}
function hasErrorCode(value, code) {
  return isRecord(value) && value.code === code;
}
function normalizeGeneratedWikiPath(value) {
  if (typeof value !== "string") throw new Error("Invalid generated wiki path: expected string");
  const normalized = value.trim();
  if (value !== normalized || normalized.includes("\\") || CONTROL_CHARS_PATTERN.test(normalized) || !normalized.startsWith("wiki/") || normalized === "wiki/" || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.length > MAX_PROJECT_RELATIVE_PATH_LENGTH || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Invalid generated wiki path: ${value}`);
  }
  return normalized;
}
function normalizeGeneratedWikiPaths(value) {
  if (!Array.isArray(value)) throw new Error("Invalid generated wiki paths: expected array");
  return value.map((entry) => normalizeGeneratedWikiPath(entry));
}
function normalizeIngestEventSlug(value) {
  if (typeof value !== "string") throw new Error("Invalid ingest event: expected string");
  if (value.length === 0 || CONTROL_CHARS_PATTERN.test(value) || !EVENT_SLUG_PATTERN.test(value)) {
    throw new Error(`Invalid ingest event: ${value}`);
  }
  return value;
}
function normalizeIngestEventSlugs(value) {
  if (!Array.isArray(value)) throw new Error("Invalid ingest events: expected array");
  return value.map((entry) => normalizeIngestEventSlug(entry));
}
function normalizeLLMWikiDocumentStatus(value) {
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
    events: value.events
  };
}
function normalizeLLMWikiDocuments(value) {
  if (!isRecord(value)) return {};
  const documents = {};
  for (const [rawPath, rawStatus] of Object.entries(value)) {
    let normalizedPath;
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
function normalizeProjectIssues(value) {
  if (!Array.isArray(value)) return [];
  const issues = [];
  for (const issue of value) {
    if (isRecord(issue) && typeof issue.code === "string" && typeof issue.path === "string" && typeof issue.message === "string") {
      issues.push({ code: issue.code, path: issue.path, message: issue.message });
    }
  }
  return issues;
}
var LLMWikiStateStore = class _LLMWikiStateStore {
  constructor(projectPath) {
    this.projectPath = projectPath;
    this.statePath = import_node_path.default.join(projectPath, ".nexus", "llm-wiki-state.json");
  }
  projectPath;
  static mutationQueues = /* @__PURE__ */ new Map();
  statePath;
  async read() {
    let content;
    try {
      content = await (0, import_promises.readFile)(this.statePath, "utf-8");
    } catch (err) {
      if (hasErrorCode(err, "ENOENT")) return emptyLLMWikiState();
      throw err;
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return emptyLLMWikiState();
    }
    if (!isRecord(parsed)) return emptyLLMWikiState();
    return {
      version: 1,
      mode: parsed.mode === "auto" ? "auto" : "manual",
      documents: normalizeLLMWikiDocuments(parsed.documents),
      projectIssues: normalizeProjectIssues(parsed.projectIssues)
    };
  }
  async write(state) {
    await (0, import_promises.mkdir)(import_node_path.default.dirname(this.statePath), { recursive: true });
    const tmpPath = import_node_path.default.join(
      import_node_path.default.dirname(this.statePath),
      `.${import_node_path.default.basename(this.statePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    );
    await (0, import_promises.writeFile)(tmpPath, `${JSON.stringify(state, null, 2)}
`, "utf-8");
    await (0, import_promises.rename)(tmpPath, this.statePath);
  }
  async mutate(mutation) {
    const previous = _LLMWikiStateStore.mutationQueues.get(this.statePath) ?? Promise.resolve();
    const current = previous.catch(() => void 0).then(mutation);
    const queued = current.catch(() => void 0);
    _LLMWikiStateStore.mutationQueues.set(this.statePath, queued);
    try {
      return await current;
    } finally {
      if (_LLMWikiStateStore.mutationQueues.get(this.statePath) === queued) {
        _LLMWikiStateStore.mutationQueues.delete(this.statePath);
      }
    }
  }
  async setMode(mode) {
    return this.mutate(async () => {
      const state = await this.read();
      state.mode = mode === "auto" ? "auto" : "manual";
      await this.write(state);
      return state;
    });
  }
  async markDirty(rawPath, content, now = /* @__PURE__ */ new Date()) {
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
        events: []
      };
      await this.write(state);
      return true;
    });
  }
  async enqueue(rawPath, now = /* @__PURE__ */ new Date()) {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const state = await this.read();
      const existing = state.documents[raw];
      if (!existing) throw new Error(`Cannot enqueue unknown raw document: ${raw}`);
      if (existing.status === "queued" || existing.status === "submitting") return existing;
      if (existing.status !== "dirty" && existing.status !== "failed") return existing;
      const next = { ...existing, status: "queued", submittedAt: now.toISOString(), error: null };
      state.documents[raw] = next;
      await this.write(state);
      return next;
    });
  }
  async start(rawPath, now = /* @__PURE__ */ new Date()) {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const state = await this.read();
      const existing = state.documents[raw];
      if (!existing) throw new Error(`Cannot start unknown raw document: ${raw}`);
      const next = {
        ...existing,
        status: "submitting",
        submittedAt: existing.submittedAt ?? now.toISOString()
      };
      state.documents[raw] = next;
      await this.write(state);
      return next;
    });
  }
  async complete(rawPath, expectedHash, result, now = /* @__PURE__ */ new Date()) {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const state = await this.read();
      const existing = state.documents[raw];
      if (!existing || existing.contentHash !== expectedHash) return null;
      const generated = normalizeGeneratedWikiPaths(result.written);
      const events = normalizeIngestEventSlugs(result.events);
      const next = {
        ...existing,
        status: "parsed",
        completedAt: now.toISOString(),
        error: null,
        generated,
        events
      };
      state.documents[raw] = next;
      await this.write(state);
      return next;
    });
  }
  async fail(rawPath, expectedHash, error, now = /* @__PURE__ */ new Date()) {
    return this.mutate(async () => {
      const raw = normalizeRawDocumentPath(rawPath);
      const state = await this.read();
      const existing = state.documents[raw];
      if (!existing || existing.contentHash !== expectedHash) return null;
      const next = {
        ...existing,
        status: "failed",
        completedAt: now.toISOString(),
        error: sanitizeStatusError(error)
      };
      state.documents[raw] = next;
      await this.write(state);
      return next;
    });
  }
  async setProjectIssues(issues) {
    return this.mutate(async () => {
      const state = await this.read();
      state.projectIssues = normalizeProjectIssues(issues);
      await this.write(state);
      return state;
    });
  }
};
var LLMWikiDocumentQueue = class {
  constructor(options) {
    this.options = options;
    if (!Number.isInteger(options.concurrency) || options.concurrency <= 0) {
      throw new Error("LLM Wiki document queue concurrency must be positive");
    }
  }
  options;
  queued = [];
  queuedSet = /* @__PURE__ */ new Set();
  running = /* @__PURE__ */ new Set();
  rerunSet = /* @__PURE__ */ new Set();
  pumpScheduled = false;
  enqueue(rawPath) {
    const raw = normalizeRawDocumentPath(rawPath);
    if (this.queuedSet.has(raw)) return;
    if (this.running.has(raw)) {
      this.rerunSet.add(raw);
      return;
    }
    this.queue(raw);
    this.schedulePump();
  }
  queue(rawPath) {
    if (this.queuedSet.has(rawPath)) return;
    this.queued.push(rawPath);
    this.queuedSet.add(rawPath);
  }
  schedulePump() {
    if (this.pumpScheduled) return;
    this.pumpScheduled = true;
    setTimeout(() => {
      this.pumpScheduled = false;
      void this.pump();
    }, 0);
  }
  async pump() {
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
  async runOne(rawPath) {
    let task = null;
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
  async failTask(rawPath, expectedHash, message) {
    try {
      const failed = await this.options.fail(rawPath, expectedHash, message);
      if (failed) this.safeEmit(rawPath, failed);
    } catch {
    }
  }
  safeEmit(rawPath, status) {
    try {
      this.options.emit(rawPath, status);
    } catch {
    }
  }
  async waitForIdle() {
    while (this.queued.length > 0 || this.running.size > 0 || this.rerunSet.size > 0 || this.pumpScheduled) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
};
var LLMWikiCompileQueue = class {
  constructor(options) {
    this.options = options;
  }
  options;
  timer = null;
  running = false;
  pendingProject = null;
  enqueue(projectPath) {
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
  runSafely(projectPath) {
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
  async run(projectPath) {
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
  safeEmit(status) {
    try {
      this.options.emit(status);
    } catch {
    }
  }
  async waitForIdleTick() {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  async waitForIdle() {
    while (this.running || this.timer || this.pendingProject) {
      await this.waitForIdleTick();
    }
  }
};
function runPythonJson(options) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (env.LLM_WIKI_ALLOW_ANTHROPIC_API_KEY !== "1") {
      delete env.ANTHROPIC_API_KEY;
    }
    env.PYTHONIOENCODING = "utf-8";
    env.PYTHONUTF8 = "1";
    const child = (0, import_node_child_process.spawn)(options.pythonCommand, [options.scriptPath, ...options.args], {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      env
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
    child.stdout.on("data", (chunk) => {
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
    child.stderr.on("data", (chunk) => {
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
      let parsed;
      try {
        parsed = JSON.parse(stdout.trim());
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
function isLLMWikiCommandResult(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.ok === "boolean" && typeof value.operation === "string";
}
function formatCommandFailure(result, code, stderr) {
  const parts = [`LLM Wiki ${result.operation} failed`];
  if (code !== 0) parts.push(`exit code ${code ?? "unknown"}`);
  if (result.error) parts.push(sanitizeCommandText(result.error));
  const issueSummary = formatCommandIssues(result.issues);
  if (issueSummary) parts.push(issueSummary);
  const cleanStderr = sanitizeCommandText(stderr.trim());
  if (cleanStderr) parts.push(`stderr: ${cleanStderr}`);
  return parts.join(": ");
}
function formatCommandIssues(issues) {
  if (!Array.isArray(issues)) return "";
  const formatted = issues.slice(0, 5).map((issue) => {
    if (!isRecord(issue)) return "";
    const code = typeof issue.code === "string" ? issue.code : "";
    const issuePath = typeof issue.path === "string" ? issue.path : "";
    const message = typeof issue.message === "string" ? issue.message : "";
    return [code, issuePath, message].filter(Boolean).join(" ");
  }).filter(Boolean);
  if (formatted.length === 0) return "";
  return sanitizeCommandText(`issues: ${formatted.join("; ")}`);
}
function sanitizeCommandText(value) {
  return value.replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET)[A-Z0-9_]*)=([^\s]+)/gi, "$1=[redacted]").replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-key]").slice(0, 2e3);
}
async function runSidecarCommand(sidecarDir, command, projectPath, options) {
  const scriptPath = import_node_path.default.join(sidecarDir, "llm_wiki.py");
  const args = [command, "--project", projectPath];
  if (command === "ingest") args.push("--provider", options?.provider ?? "fixture");
  return runPythonJson({
    pythonCommand: options?.pythonCommand ?? "python",
    scriptPath,
    args,
    timeoutMs: options?.timeoutMs ?? 12e4,
    maxStdoutBytes: options?.maxStdoutBytes ?? 1024 * 1024,
    cwd: sidecarDir
  });
}
async function runSidecarCompile(sidecarDir, projectPath, options) {
  await runSidecarCommand(sidecarDir, "ensure", projectPath, options);
  const ingest = await runSidecarCommand(sidecarDir, "ingest", projectPath, options);
  const lint = await runSidecarCommand(sidecarDir, "lint", projectPath, options);
  return {
    ok: true,
    operation: "compile",
    written: ingest.written ?? [],
    issues: lint.issues ?? []
  };
}
function isSafeGeneratedWikiPath(value) {
  try {
    normalizeGeneratedWikiPath(value);
    return true;
  } catch {
    return false;
  }
}
function isSafeIngestSlug(value) {
  try {
    normalizeIngestEventSlug(value);
    return true;
  } catch {
    return false;
  }
}
function isLLMWikiIngestFileResult(value, expectedRawPath) {
  const candidate = value;
  return candidate.operation === "ingest-file" && candidate.raw === expectedRawPath && Array.isArray(candidate.written) && candidate.written.every(isSafeGeneratedWikiPath) && Array.isArray(candidate.pages) && candidate.pages.every(isSafeIngestSlug) && Array.isArray(candidate.events) && candidate.events.every(isSafeIngestSlug);
}
async function runSidecarIngestFile(sidecarDir, projectPath, rawPath, options) {
  const scriptPath = import_node_path.default.join(sidecarDir, "llm_wiki.py");
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
      options?.provider ?? "fixture"
    ],
    timeoutMs: options?.timeoutMs ?? 12e4,
    maxStdoutBytes: options?.maxStdoutBytes ?? 1024 * 1024,
    cwd: sidecarDir,
    allowCommandFailure: true
  });
  if (!isLLMWikiIngestFileResult(result, normalizedRawPath)) {
    if (!result.ok) {
      throw new Error(formatCommandFailure(result, null, ""));
    }
    throw new Error("LLM Wiki ingest-file returned malformed payload");
  }
  return result;
}
function isLLMWikiAskResult(value) {
  const candidate = value;
  return candidate.operation === "query" && typeof candidate.answer === "string" && Array.isArray(candidate.citations) && candidate.citations.every(
    (citation) => typeof citation === "object" && citation !== null && !Array.isArray(citation) && typeof citation.path === "string" && (citation.quote === void 0 || typeof citation.quote === "string")
  ) && Array.isArray(candidate.read) && candidate.read.every((entry) => typeof entry === "string") && (candidate.usage === void 0 || typeof candidate.usage === "object" && candidate.usage !== null && !Array.isArray(candidate.usage));
}
async function runSidecarQuery(sidecarDir, projectPath, question, options) {
  if ((options?.provider ?? "fixture") !== "deepseek") {
    throw new Error("LLM Wiki Ask requires DeepSeek provider.");
  }
  const scriptPath = import_node_path.default.join(sidecarDir, "llm_wiki.py");
  const result = await runPythonJson({
    pythonCommand: options?.pythonCommand ?? "python",
    scriptPath,
    args: ["query", "--project", projectPath, "--question", question],
    timeoutMs: options?.timeoutMs ?? 12e4,
    maxStdoutBytes: options?.maxStdoutBytes ?? 1024 * 1024,
    cwd: sidecarDir
  });
  if (!isLLMWikiAskResult(result)) {
    throw new Error("LLM Wiki query returned malformed answer payload");
  }
  return result;
}

// electron/main.ts
import_electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: "nexus-vault",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
]);
var mainWindow = null;
var SUPPORTED_EXT = /* @__PURE__ */ new Set([".md", ".markdown", ".txt"]);
var SKIP_DIRS = /* @__PURE__ */ new Set(["node_modules", ".git", ".svn", ".hg", ".DS_Store"]);
var activeVault = null;
var activeWatcher = null;
var lastLLMWikiStatus = null;
var documentQueues = /* @__PURE__ */ new Map();
function resolveTrustedLLMWikiProjectRoot() {
  return resolveLLMWikiProjectRoot(activeVault, import_electron.app.getPath("documents"));
}
function llmWikiSidecarDir() {
  if (import_electron.app.isPackaged) {
    return import_node_path2.default.join(process.resourcesPath, "llm-wiki");
  }
  return import_node_path2.default.resolve(__dirname, "../llm-wiki");
}
function emitLLMWikiStatus(status) {
  lastLLMWikiStatus = status;
  mainWindow?.webContents.send("llm-wiki:status", status);
}
function emitLLMWikiDocStatus(projectPath, rawPath, status) {
  mainWindow?.webContents.send("llm-wiki:doc-status", { projectPath, rawPath, status });
}
var llmWikiQueue = new LLMWikiCompileQueue({
  debounceMs: parsePositiveInteger(process.env.LLM_WIKI_DEBOUNCE_MS, 800),
  async runner(projectPath) {
    const config = await getLLMWikiConfigStatus(llmWikiSidecarDir());
    return runSidecarCompile(llmWikiSidecarDir(), projectPath, {
      pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
      provider: config.provider,
      timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 12e4),
      maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024)
    });
  },
  emit: emitLLMWikiStatus
});
function stateStoreFor(projectPath) {
  return new LLMWikiStateStore(projectPath);
}
function queueFor(projectPath) {
  let queue = documentQueues.get(projectPath);
  if (queue) return queue;
  const store = stateStoreFor(projectPath);
  queue = new LLMWikiDocumentQueue({
    concurrency: 4,
    loadTask: async (rawPath) => {
      const state = await store.start(rawPath);
      emitLLMWikiDocStatus(projectPath, rawPath, state);
      return { rawPath, contentHash: state.contentHash };
    },
    runner: async (task) => {
      const config = await getLLMWikiConfigStatus(llmWikiSidecarDir());
      return runSidecarIngestFile(llmWikiSidecarDir(), projectPath, task.rawPath, {
        pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
        timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 12e4),
        maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024),
        provider: config.provider ?? "fixture"
      });
    },
    complete: async (rawPath, hash, result) => {
      const completed = await store.complete(rawPath, hash, result);
      await store.setProjectIssues(normalizeProjectIssues(result.issues));
      return completed;
    },
    fail: async (rawPath, hash, error) => {
      try {
        return await store.fail(rawPath, hash, error);
      } catch (err) {
        console.warn("[llm-wiki] failed to persist document failure status:", err);
        throw err;
      }
    },
    emit: (rawPath, status) => emitLLMWikiDocStatus(projectPath, rawPath, status)
  });
  documentQueues.set(projectPath, queue);
  return queue;
}
function createWindow() {
  mainWindow = new import_electron.BrowserWindow({
    width: 1024,
    height: 768,
    // Hide until the renderer has painted — avoids the white-flash window and
    // stops the dock bounce earlier (macOS treats `ready-to-show` as "app
    // finished launching"). Default behavior shows a blank window the moment
    // the BrowserWindow is created, and the dock keeps bouncing until the
    // renderer reports first paint anyway.
    show: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: import_node_path2.default.join(__dirname, "preload.js")
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(import_node_path2.default.join(__dirname, "../dist/index.html"));
  }
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    const meta = input.meta || input.control;
    if (input.type === "keyDown") {
      if (meta && input.shift && (input.key === "I" || input.key === "i") || input.key === "F12") {
        mainWindow?.webContents.toggleDevTools();
      }
    }
  });
}
import_electron.ipcMain.handle("demo:open-file", async () => {
  if (!mainWindow) return null;
  const result = await import_electron.dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const content = await (0, import_promises2.readFile)(filePath, "utf-8");
  return { path: filePath, content };
});
import_electron.ipcMain.handle(
  "demo:save-file",
  async (_event, filePath, content) => {
    await (0, import_promises2.writeFile)(filePath, content, "utf-8");
    return { path: filePath };
  }
);
import_electron.ipcMain.handle(
  "demo:save-file-as",
  async (_event, content) => {
    if (!mainWindow) return null;
    const result = await import_electron.dialog.showSaveDialog(mainWindow, {
      filters: [
        { name: "Markdown", extensions: ["md"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) return null;
    await (0, import_promises2.writeFile)(result.filePath, content, "utf-8");
    return { path: result.filePath };
  }
);
function assertInsideVault(target) {
  if (!activeVault) {
    throw new Error("No active vault");
  }
  const resolved = import_node_path2.default.resolve(target);
  const rel = import_node_path2.default.relative(activeVault, resolved);
  if (rel === "" || rel === ".") return resolved;
  if (rel.startsWith("..") || import_node_path2.default.isAbsolute(rel)) {
    throw new Error(`Path escapes vault: ${target}`);
  }
  return resolved;
}
async function scanDirectory(dir) {
  const entries = await (0, import_promises2.readdir)(dir, { withFileTypes: true });
  const nodes = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;
    const childPath = import_node_path2.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      const children = await scanDirectory(childPath);
      if (children.length > 0) {
        nodes.push({
          name: entry.name,
          path: childPath,
          kind: "directory",
          children
        });
      }
      continue;
    }
    if (entry.isFile()) {
      const ext = import_node_path2.default.extname(entry.name).toLowerCase();
      if (!SUPPORTED_EXT.has(ext)) continue;
      nodes.push({ name: entry.name, path: childPath, kind: "file" });
    }
  }
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return nodes;
}
function debounce(fn, ms) {
  let timer = null;
  return ((...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  });
}
function stopWatcher() {
  if (activeWatcher) {
    try {
      activeWatcher.close();
    } catch {
    }
    activeWatcher = null;
  }
}
function startWatcher(vaultPath) {
  stopWatcher();
  const notify = debounce(() => {
    mainWindow?.webContents.send("vault:changed", { vault: vaultPath });
  }, 150);
  try {
    activeWatcher = (0, import_node_fs2.watch)(vaultPath, { recursive: true }, () => notify());
  } catch (err) {
    try {
      activeWatcher = (0, import_node_fs2.watch)(vaultPath, () => notify());
    } catch (innerErr) {
      console.warn("[vault] watcher init failed:", innerErr);
      activeWatcher = null;
    }
  }
}
async function activateVault(vaultPath) {
  const abs = import_node_path2.default.resolve(vaultPath);
  const info = await (0, import_promises2.stat)(abs);
  if (!info.isDirectory()) throw new Error(`Not a directory: ${abs}`);
  activeVault = abs;
  startWatcher(abs);
  return abs;
}
function vaultStatePath() {
  return import_node_path2.default.join(import_electron.app.getPath("userData"), "vault.json");
}
async function readVaultState() {
  const file = vaultStatePath();
  if (!(0, import_node_fs2.existsSync)(file)) return { lastVault: null, recents: [] };
  try {
    const raw = await (0, import_promises2.readFile)(file, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      lastVault: typeof parsed.lastVault === "string" ? parsed.lastVault : null,
      recents: Array.isArray(parsed.recents) ? parsed.recents.filter((r) => typeof r === "string") : []
    };
  } catch {
    return { lastVault: null, recents: [] };
  }
}
async function writeVaultState(state) {
  await (0, import_promises2.writeFile)(vaultStatePath(), JSON.stringify(state, null, 2), "utf-8");
}
import_electron.ipcMain.handle("vault:pick", async () => {
  if (!mainWindow) return null;
  const result = await import_electron.dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return { path: result.filePaths[0] };
});
import_electron.ipcMain.handle("vault:list", async (_event, vaultPath) => {
  const abs = await activateVault(vaultPath);
  return scanDirectory(abs);
});
import_electron.ipcMain.handle("vault:read", async (_event, filePath) => {
  const abs = assertInsideVault(filePath);
  const content = await (0, import_promises2.readFile)(abs, "utf-8");
  return { path: abs, content };
});
async function collectFiles(dir, acc) {
  const entries = await (0, import_promises2.readdir)(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const childPath = import_node_path2.default.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(childPath, acc);
      continue;
    }
    if (entry.isFile() && SUPPORTED_EXT.has(import_node_path2.default.extname(entry.name).toLowerCase())) {
      acc.push(childPath);
    }
  }
}
import_electron.ipcMain.handle("vault:read-all", async () => {
  if (!activeVault) return [];
  const paths = [];
  await collectFiles(activeVault, paths);
  const CONCURRENCY = 32;
  const out = [];
  let cursor = 0;
  async function worker() {
    while (cursor < paths.length) {
      const i = cursor++;
      const p = paths[i];
      try {
        const abs = assertInsideVault(p);
        const content = await (0, import_promises2.readFile)(abs, "utf-8");
        out.push({ path: abs, content });
      } catch {
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, paths.length) }, worker));
  return out;
});
import_electron.ipcMain.handle("vault:write", async (_event, filePath, content) => {
  const abs = assertInsideVault(filePath);
  await (0, import_promises2.writeFile)(abs, content, "utf-8");
  return { path: abs };
});
import_electron.ipcMain.handle("llm-wiki:get-status", async () => {
  return lastLLMWikiStatus;
});
import_electron.ipcMain.handle("llm-wiki:get-config-status", async () => {
  return getLLMWikiConfigStatus(llmWikiSidecarDir());
});
import_electron.ipcMain.handle(
  "llm-wiki:save-config",
  async (_event, input) => {
    return writeLLMWikiConfig(llmWikiSidecarDir(), input);
  }
);
import_electron.ipcMain.handle(
  "llm-wiki:ask",
  async (_event, input) => {
    const question = String(input.question ?? "").trim();
    if (!question) throw new Error("Question cannot be empty");
    const projectPath = resolveTrustedLLMWikiProjectRoot();
    const config = await getLLMWikiConfigStatus(llmWikiSidecarDir());
    if (config.provider !== "deepseek") {
      throw new Error("LLM Wiki Ask requires DeepSeek provider.");
    }
    await runSidecarCommand(llmWikiSidecarDir(), "ensure", projectPath, {
      pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
      timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 12e4),
      maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024)
    });
    return runSidecarQuery(llmWikiSidecarDir(), projectPath, question, {
      pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
      timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 12e4),
      maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024),
      provider: config.provider
    });
  }
);
import_electron.ipcMain.handle("llm-wiki:open-schema", async (_event, input) => {
  void input;
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  await runSidecarCommand(llmWikiSidecarDir(), "ensure", projectPath, {
    pythonCommand: process.env.LLM_WIKI_PYTHON ?? "python",
    timeoutMs: parsePositiveInteger(process.env.LLM_WIKI_TIMEOUT_MS, 12e4),
    maxStdoutBytes: parsePositiveInteger(process.env.LLM_WIKI_MAX_STDOUT_BYTES, 1024 * 1024)
  });
  await activateVault(projectPath);
  const schemaPath = import_node_path2.default.join(projectPath, ".nexus", "llm-wiki-schema.md");
  const content = await (0, import_promises2.readFile)(schemaPath, "utf-8");
  return { projectPath, schemaPath, content };
});
import_electron.ipcMain.handle("llm-wiki:get-doc-statuses", async () => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const state = await stateStoreFor(projectPath).read();
  return { projectPath, state };
});
import_electron.ipcMain.handle("llm-wiki:get-submit-mode", async () => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  return { projectPath, mode: (await stateStoreFor(projectPath).read()).mode };
});
import_electron.ipcMain.handle("llm-wiki:set-submit-mode", async (_event, mode) => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const state = await stateStoreFor(projectPath).setMode(mode === "auto" ? "auto" : "manual");
  return { projectPath, mode: state.mode };
});
import_electron.ipcMain.handle("llm-wiki:submit-doc", async (_event, input) => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const rawPath = normalizeRawDocumentPath(String(input?.rawPath ?? ""));
  const store = stateStoreFor(projectPath);
  const status = await store.enqueue(rawPath);
  emitLLMWikiDocStatus(projectPath, rawPath, status);
  queueFor(projectPath).enqueue(rawPath);
  return { projectPath, rawPath, status };
});
import_electron.ipcMain.handle("llm-wiki:submit-all-dirty", async () => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const store = stateStoreFor(projectPath);
  const state = await store.read();
  const submitted = [];
  for (const [rawPath, status] of Object.entries(state.documents)) {
    if (status.status !== "dirty") continue;
    const next = await store.enqueue(rawPath);
    emitLLMWikiDocStatus(projectPath, rawPath, next);
    queueFor(projectPath).enqueue(rawPath);
    submitted.push(rawPath);
  }
  return { projectPath, submitted };
});
import_electron.ipcMain.handle("llm-wiki:retry-failed", async () => {
  const projectPath = resolveTrustedLLMWikiProjectRoot();
  const store = stateStoreFor(projectPath);
  const state = await store.read();
  const submitted = [];
  for (const [rawPath, status] of Object.entries(state.documents)) {
    if (status.status !== "failed") continue;
    const next = await store.enqueue(rawPath);
    emitLLMWikiDocStatus(projectPath, rawPath, next);
    queueFor(projectPath).enqueue(rawPath);
    submitted.push(rawPath);
  }
  return { projectPath, submitted };
});
import_electron.ipcMain.handle(
  "llm-wiki:save-source",
  async (_event, input) => {
    const projectPath = resolveTrustedLLMWikiProjectRoot();
    return saveLLMWikiSource(
      { projectPath, currentPath: input.currentPath, content: input.content ?? "" },
      {
        mkdir: import_promises2.mkdir,
        activateVault,
        writeFile: import_promises2.writeFile,
        pathExists: import_node_fs2.existsSync,
        enqueueCompile: (queuedProjectPath) => llmWikiQueue.enqueue(queuedProjectPath),
        markDirty: async (dirtyProjectPath, rawPath, content) => {
          const changed = await stateStoreFor(dirtyProjectPath).markDirty(rawPath, content);
          const state = await stateStoreFor(dirtyProjectPath).read();
          const status = state.documents[rawPath];
          if (status) emitLLMWikiDocStatus(dirtyProjectPath, rawPath, status);
          return changed;
        },
        shouldAutoSubmit: async (dirtyProjectPath) => (await stateStoreFor(dirtyProjectPath).read()).mode === "auto",
        enqueueDocument: (dirtyProjectPath, rawPath) => {
          void stateStoreFor(dirtyProjectPath).enqueue(rawPath).then((status) => {
            emitLLMWikiDocStatus(dirtyProjectPath, rawPath, status);
            queueFor(dirtyProjectPath).enqueue(rawPath);
          }).catch((err) => {
            console.warn("[llm-wiki] failed to enqueue saved document:", err);
          });
        }
      }
    );
  }
);
import_electron.ipcMain.handle(
  "vault:create-file",
  async (_event, parentDir, name) => {
    const safeInput = name.trim() || "untitled";
    const normInput = safeInput.replace(/\\/g, "/");
    const segments = normInput.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) throw new Error("Invalid file name");
    const baseNameRaw = segments.pop();
    const subDirs = segments.join("/");
    const parent = assertInsideVault(
      subDirs ? import_node_path2.default.join(parentDir, subDirs) : parentDir
    );
    if (subDirs) {
      await (0, import_promises2.mkdir)(parent, { recursive: true });
    }
    const hasExt = SUPPORTED_EXT.has(import_node_path2.default.extname(baseNameRaw).toLowerCase());
    const baseName = hasExt ? baseNameRaw : `${baseNameRaw}.md`;
    const ext = import_node_path2.default.extname(baseName);
    const stem = baseName.slice(0, baseName.length - ext.length);
    let candidate = import_node_path2.default.join(parent, baseName);
    let suffix = 1;
    while ((0, import_node_fs2.existsSync)(candidate)) {
      candidate = import_node_path2.default.join(parent, `${stem}-${suffix}${ext}`);
      suffix += 1;
    }
    const finalPath = assertInsideVault(candidate);
    await (0, import_promises2.writeFile)(finalPath, "", "utf-8");
    return { path: finalPath };
  }
);
import_electron.ipcMain.handle(
  "vault:create-folder",
  async (_event, parentDir, name) => {
    const parent = assertInsideVault(parentDir);
    const safeName = name.trim() || "new-folder";
    const target = assertInsideVault(import_node_path2.default.join(parent, safeName));
    if ((0, import_node_fs2.existsSync)(target)) {
      throw new Error(`Folder already exists: ${safeName}`);
    }
    await (0, import_promises2.mkdir)(target, { recursive: false });
    return { path: target };
  }
);
import_electron.ipcMain.handle(
  "vault:rename",
  async (_event, oldPath, newName) => {
    const src = assertInsideVault(oldPath);
    const parent = import_node_path2.default.dirname(src);
    const trimmed = newName.trim();
    if (!trimmed) throw new Error("New name cannot be empty");
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      throw new Error("New name cannot contain path separators");
    }
    const target = assertInsideVault(import_node_path2.default.join(parent, trimmed));
    if ((0, import_node_fs2.existsSync)(target) && target !== src) {
      throw new Error(`Target already exists: ${trimmed}`);
    }
    await (0, import_promises2.rename)(src, target);
    return { path: target };
  }
);
import_electron.ipcMain.handle("vault:delete", async (_event, targetPath) => {
  const abs = assertInsideVault(targetPath);
  await import_electron.shell.trashItem(abs);
  return { ok: true };
});
import_electron.ipcMain.handle("vault:get-last", async () => {
  const state = await readVaultState();
  if (state.lastVault && !(0, import_node_fs2.existsSync)(state.lastVault)) {
    const cleaned = {
      lastVault: null,
      recents: state.recents.filter((r) => (0, import_node_fs2.existsSync)(r))
    };
    await writeVaultState(cleaned);
    return cleaned;
  }
  return state;
});
import_electron.ipcMain.handle("vault:set-last", async (_event, vaultPath) => {
  const current = await readVaultState();
  const recents = [vaultPath, ...current.recents.filter((r) => r !== vaultPath)].slice(0, 10);
  await writeVaultState({ lastVault: vaultPath, recents });
  return { ok: true };
});
import_electron.app.whenReady().then(() => {
  import_electron.protocol.handle("nexus-vault", async (request) => {
    try {
      if (!activeVault) return new Response("No active vault", { status: 404 });
      const url = new URL(request.url);
      const relPath = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      if (!relPath) return new Response("Empty path", { status: 400 });
      const abs = import_node_path2.default.resolve(activeVault, relPath);
      const rel = import_node_path2.default.relative(activeVault, abs);
      if (rel.startsWith("..") || import_node_path2.default.isAbsolute(rel)) {
        return new Response("Path escapes vault", { status: 403 });
      }
      if (!(0, import_node_fs2.existsSync)(abs)) return new Response("Not found", { status: 404 });
      return import_electron.net.fetch((0, import_node_url.pathToFileURL)(abs).toString());
    } catch (err) {
      return new Response(String(err), { status: 500 });
    }
  });
  createWindow();
});
import_electron.app.on("window-all-closed", () => {
  stopWatcher();
  import_electron.app.quit();
});
