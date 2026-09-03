import {
  asDocumentId,
  asFileId,
  type DocumentId,
  type FileId,
} from "@floatboat/nexus-plugin-collab";
import { normalizeVaultPath } from "@floatboat/nexus-plugin-runtime";

import type {
  PluginHostBridge,
  PluginStorageSnapshot,
  VaultId,
  VaultSessionId,
} from "../shared/plugin-ipc";
import { canonicalCollaborationServerUrl } from "./collaboration-server-url";

export const COLLABORATION_ENROLLMENT_SCHEMA_VERSION = 1 as const;
export const COLLABORATION_ENROLLMENT_STATE_SCHEMA_VERSION = 4 as const;
export const COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION = 1 as const;

const DEFAULT_PLUGIN_ID = "nexus-collaboration-enrollment";
const DEFAULT_MAX_SAVE_ATTEMPTS = 8;
const MAX_SAVE_ATTEMPTS = 32;
const MAX_ENROLLMENTS = 10_000;
const MAX_PATH_LENGTH = 4_096;
const MAX_SERVER_URL_LENGTH = 2_048;
const MAX_TITLE_LENGTH = 512;

export type CollaborationEnrollmentAccess = "owner" | "editor" | "reader";

export interface CollaborationEnrollmentInput {
  readonly fileId: FileId;
  readonly path: string;
  readonly documentId: DocumentId;
  readonly serverUrl: string;
  readonly access: CollaborationEnrollmentAccess;
  readonly title: string;
}

/** Non-sensitive information needed to resume one Host collaboration enrollment. */
export interface CollaborationEnrollmentRecord extends CollaborationEnrollmentInput {
  readonly schemaVersion: typeof COLLABORATION_ENROLLMENT_SCHEMA_VERSION;
}

/**
 * Durable, non-secret evidence that a remote create may have happened before
 * the local enrollment was committed. It deliberately has the same bounded
 * identity fields as an enrollment and never contains a credential.
 */
export interface CollaborationPendingCreationRecord
  extends Omit<CollaborationEnrollmentRecord, "access"> {
  readonly access: "owner";
}

/** Durable tombstone proving that one exact identity, rather than merely its FileId, was removed. */
export interface CollaborationIdentityDeletion {
  readonly schemaVersion: typeof COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION;
  readonly operationId: string;
  readonly kind: "enrollment" | "pending-creation";
  readonly record: CollaborationEnrollmentRecord;
}

/** Durable cross-window permit held for the complete filesystem-delete lifecycle. */
export interface CollaborationPathDeletionReservation {
  readonly schemaVersion: typeof COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION;
  readonly operationId: string;
  readonly path: string;
}

/** Immutable Host ownership captured before an invitation join may project to disk. */
export interface CollaborationPendingJoinOwner {
  readonly vaultId: VaultId;
  readonly senderId: number;
  readonly sessionId: VaultSessionId;
}

/**
 * Non-secret recovery record spanning Host opening admission, Projection Base
 * creation, Enrollment commit, and final Host-fence release.
 */
export interface CollaborationPendingJoin {
  readonly schemaVersion: typeof COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION;
  readonly operationId: string;
  readonly owner: CollaborationPendingJoinOwner;
  readonly phase: "opening" | "enrollment-committed";
  readonly enrollment: CollaborationEnrollmentRecord;
}

export interface CollaborationPendingJoinInput {
  readonly operationId: string;
  readonly owner: CollaborationPendingJoinOwner;
  readonly enrollment: CollaborationEnrollmentInput;
}

export interface CollaborationEnrollmentStore {
  findByPath(path: string): Promise<CollaborationEnrollmentRecord | null>;
  findByFileId(fileId: FileId): Promise<CollaborationEnrollmentRecord | null>;
  list(): Promise<readonly CollaborationEnrollmentRecord[]>;
  findPendingCreationByPath(path: string): Promise<CollaborationPendingCreationRecord | null>;
  listPendingCreations(): Promise<readonly CollaborationPendingCreationRecord[]>;
  listIdentityDeletions(): Promise<readonly CollaborationIdentityDeletion[]>;
  listDeletionReservations(): Promise<readonly CollaborationPathDeletionReservation[]>;
  listPendingJoins(): Promise<readonly CollaborationPendingJoin[]>;
  assertProjectionWriteAuthorized(
    identity: Pick<CollaborationEnrollmentInput, "fileId" | "path" | "documentId">,
    options?: { readonly openingOperationId?: string },
  ): Promise<void>;
  beginJoin(input: CollaborationPendingJoinInput): Promise<CollaborationPendingJoin>;
  commitJoin(intent: CollaborationPendingJoin): Promise<CollaborationPendingJoin>;
  completeJoin(intent: CollaborationPendingJoin): Promise<boolean>;
  abortJoin(intent: CollaborationPendingJoin): Promise<boolean>;
  beginCreation(
    input: CollaborationEnrollmentInput & { readonly access: "owner" },
  ): Promise<CollaborationPendingCreationRecord>;
  commitCreation(intent: CollaborationPendingCreationRecord): Promise<CollaborationEnrollmentRecord>;
  forgetPendingCreation(
    expected: CollaborationPendingCreationRecord,
  ): Promise<CollaborationIdentityDeletion | null>;
  upsert(input: CollaborationEnrollmentInput): Promise<CollaborationEnrollmentRecord>;
  rename(
    expected: CollaborationEnrollmentRecord,
    path: string,
    title?: string,
  ): Promise<CollaborationEnrollmentRecord>;
  forget(expected: CollaborationEnrollmentRecord): Promise<CollaborationIdentityDeletion | null>;
  restoreForget(
    deletion: CollaborationIdentityDeletion,
    reservation?: CollaborationPathDeletionReservation,
  ): Promise<CollaborationEnrollmentRecord>;
  completeForget(deletion: CollaborationIdentityDeletion): Promise<boolean>;
  reserveDeletion(path: string, operationId?: string): Promise<CollaborationPathDeletionReservation>;
  releaseDeletion(reservation: CollaborationPathDeletionReservation): Promise<boolean>;
}

export type CollaborationEnrollmentStoreErrorCode =
  | "enrollment-invalid"
  | "enrollment-corrupt"
  | "enrollment-conflict"
  | "enrollment-delete-reserved"
  | "enrollment-not-found"
  | "pending-creation-delete-blocked"
  | "pending-join-delete-blocked"
  | "projection-identity-unavailable"
  | "enrollment-read-failed"
  | "enrollment-write-failed";

export class CollaborationEnrollmentStoreError extends Error {
  constructor(
    readonly code: CollaborationEnrollmentStoreErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CollaborationEnrollmentStoreError";
  }
}

export interface CollaborationEnrollmentStoreOptions {
  readonly bridge: Pick<PluginHostBridge, "storage">;
  /** Use a Vault-scoped id when multiple Vaults share the same Host storage. */
  readonly pluginId?: string;
  /** Test/Host tuning seam. Production callers should normally use the bounded default. */
  readonly maxSaveAttempts?: number;
  /** Test seam. Production uses a cryptographically random per-operation id. */
  readonly operationIdGenerator?: () => string;
}

interface StoredEnrollmentState {
  readonly schemaVersion: typeof COLLABORATION_ENROLLMENT_STATE_SCHEMA_VERSION;
  readonly enrollments: readonly CollaborationEnrollmentRecord[];
  readonly pendingCreations: readonly CollaborationPendingCreationRecord[];
  readonly identityDeletions: readonly CollaborationIdentityDeletion[];
  readonly pathDeletionReservations: readonly CollaborationPathDeletionReservation[];
  readonly pendingJoins: readonly CollaborationPendingJoin[];
}

interface Mutation<T> {
  readonly state: StoredEnrollmentState;
  readonly result: T;
  readonly changed: boolean;
}

const INPUT_KEYS = ["access", "documentId", "fileId", "path", "serverUrl", "title"] as const;
const RECORD_KEYS = ["access", "documentId", "fileId", "path", "schemaVersion", "serverUrl", "title"] as const;
const LEGACY_STATE_KEYS = ["enrollments", "schemaVersion"] as const;
const V2_STATE_KEYS = ["enrollments", "pendingCreations", "schemaVersion"] as const;
const V3_STATE_KEYS = [
  "enrollments",
  "identityDeletions",
  "pathDeletionReservations",
  "pendingCreations",
  "schemaVersion",
] as const;
const STATE_KEYS = [
  "enrollments",
  "identityDeletions",
  "pathDeletionReservations",
  "pendingCreations",
  "pendingJoins",
  "schemaVersion",
] as const;
const IDENTITY_DELETION_KEYS = ["kind", "operationId", "record", "schemaVersion"] as const;
const PATH_DELETION_RESERVATION_KEYS = ["operationId", "path", "schemaVersion"] as const;
const PENDING_JOIN_KEYS = ["enrollment", "operationId", "owner", "phase", "schemaVersion"] as const;
const PENDING_JOIN_OWNER_KEYS = ["senderId", "sessionId", "vaultId"] as const;
const PENDING_JOIN_INPUT_KEYS = ["enrollment", "operationId", "owner"] as const;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function error(
  code: "enrollment-invalid" | "enrollment-corrupt",
  message: string,
  cause?: unknown,
): CollaborationEnrollmentStoreError {
  return new CollaborationEnrollmentStoreError(code, message, cause);
}

function boundedString(
  value: unknown,
  label: string,
  maximum: number,
  code: "enrollment-invalid" | "enrollment-corrupt",
): string {
  if (typeof value !== "string") throw error(code, `${label} must be a string`);
  const normalized = value.trim().normalize("NFC");
  if (normalized.length === 0 || normalized.length > maximum || normalized.includes("\0")) {
    throw error(code, `${label} is invalid`);
  }
  return normalized;
}

function normalizedFileId(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): FileId {
  const raw = boundedString(value, "FileId", 256, code);
  try {
    return asFileId(raw);
  } catch (cause) {
    throw error(code, "FileId is invalid", cause);
  }
}

function normalizedDocumentId(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): DocumentId {
  const raw = boundedString(value, "DocumentId", 256, code);
  try {
    return asDocumentId(raw);
  } catch (cause) {
    throw error(code, "DocumentId is invalid", cause);
  }
}

function normalizedPath(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PATH_LENGTH) {
    throw error(code, "Enrollment path is invalid");
  }
  try {
    const normalized = normalizeVaultPath(value);
    if (normalized.length === 0 || normalized.length > MAX_PATH_LENGTH) {
      throw error(code, "Enrollment path is invalid");
    }
    return normalized;
  } catch (cause) {
    if (cause instanceof CollaborationEnrollmentStoreError) throw cause;
    throw error(code, "Enrollment path must be Vault-relative", cause);
  }
}

function normalizedOperationId(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): string {
  return boundedString(value, "Enrollment mutation operation id", 256, code);
}

function pathWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix.replace(/\/+$/u, "")}/`);
}

function pathsOverlap(left: string, right: string): boolean {
  return pathWithin(left, right) || pathWithin(right, left);
}

function normalizedServerUrl(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): string {
  const raw = boundedString(value, "Collaboration server URL", MAX_SERVER_URL_LENGTH, code);
  try {
    return canonicalCollaborationServerUrl(raw);
  } catch (cause) {
    if (cause instanceof CollaborationEnrollmentStoreError) throw cause;
    throw error(code, "Collaboration server must use wss:, except for ws: on loopback", cause);
  }
}

function normalizedAccess(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): CollaborationEnrollmentAccess {
  if (value !== "owner" && value !== "editor" && value !== "reader") {
    throw error(code, "Collaboration enrollment access is invalid");
  }
  return value;
}

function normalizeFields(
  value: Record<string, unknown>,
  code: "enrollment-invalid" | "enrollment-corrupt",
): CollaborationEnrollmentRecord {
  return {
    schemaVersion: COLLABORATION_ENROLLMENT_SCHEMA_VERSION,
    fileId: normalizedFileId(value.fileId, code),
    path: normalizedPath(value.path, code),
    documentId: normalizedDocumentId(value.documentId, code),
    serverUrl: normalizedServerUrl(value.serverUrl, code),
    access: normalizedAccess(value.access, code),
    title: boundedString(value.title, "Enrollment title", MAX_TITLE_LENGTH, code),
  };
}

function parseInput(value: unknown): CollaborationEnrollmentRecord {
  const candidate = object(value);
  if (!candidate || !hasExactlyKeys(candidate, INPUT_KEYS)) {
    throw error(
      "enrollment-invalid",
      "Enrollment must contain only fileId, path, documentId, serverUrl, access, and title",
    );
  }
  return normalizeFields(candidate, "enrollment-invalid");
}

function parseStoredRecord(value: unknown): CollaborationEnrollmentRecord {
  const candidate = object(value);
  if (
    !candidate ||
    !hasExactlyKeys(candidate, RECORD_KEYS) ||
    candidate.schemaVersion !== COLLABORATION_ENROLLMENT_SCHEMA_VERSION
  ) {
    throw error("enrollment-corrupt", "Persisted collaboration enrollment has an invalid schema");
  }
  const normalized = normalizeFields(candidate, "enrollment-corrupt");
  if (
    normalized.fileId !== candidate.fileId ||
    normalized.path !== candidate.path ||
    normalized.documentId !== candidate.documentId ||
    normalized.serverUrl !== candidate.serverUrl ||
    normalized.title !== candidate.title
  ) {
    throw error("enrollment-corrupt", "Persisted collaboration enrollment is not canonical");
  }
  return normalized;
}

function parseRecordInput(value: unknown): CollaborationEnrollmentRecord {
  const candidate = object(value);
  if (
    !candidate ||
    !hasExactlyKeys(candidate, RECORD_KEYS) ||
    candidate.schemaVersion !== COLLABORATION_ENROLLMENT_SCHEMA_VERSION
  ) {
    throw error("enrollment-invalid", "Pending creation has an invalid schema");
  }
  const normalized = normalizeFields(candidate, "enrollment-invalid");
  if (
    normalized.fileId !== candidate.fileId ||
    normalized.path !== candidate.path ||
    normalized.documentId !== candidate.documentId ||
    normalized.serverUrl !== candidate.serverUrl ||
    normalized.title !== candidate.title
  ) {
    throw error("enrollment-invalid", "Pending creation must be canonical");
  }
  return normalized;
}

function parseIdentityDeletion(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): CollaborationIdentityDeletion {
  const candidate = object(value);
  if (
    !candidate ||
    !hasExactlyKeys(candidate, IDENTITY_DELETION_KEYS) ||
    candidate.schemaVersion !== COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION ||
    (candidate.kind !== "enrollment" && candidate.kind !== "pending-creation")
  ) {
    throw error(code, "Collaboration identity deletion has an invalid schema");
  }
  const record = code === "enrollment-corrupt"
    ? parseStoredRecord(candidate.record)
    : parseRecordInput(candidate.record);
  if (candidate.kind === "pending-creation") ownerCreationRecord(record, code);
  return {
    schemaVersion: COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION,
    operationId: normalizedOperationId(candidate.operationId, code),
    kind: candidate.kind,
    record,
  };
}

function parsePathDeletionReservation(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): CollaborationPathDeletionReservation {
  const candidate = object(value);
  if (
    !candidate ||
    !hasExactlyKeys(candidate, PATH_DELETION_RESERVATION_KEYS) ||
    candidate.schemaVersion !== COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION
  ) {
    throw error(code, "Collaboration path deletion reservation has an invalid schema");
  }
  return {
    schemaVersion: COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION,
    operationId: normalizedOperationId(candidate.operationId, code),
    path: normalizedPath(candidate.path, code),
  };
}

function parsePendingJoinOwner(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): CollaborationPendingJoinOwner {
  const candidate = object(value);
  if (!candidate || !hasExactlyKeys(candidate, PENDING_JOIN_OWNER_KEYS)) {
    throw error(code, "Pending collaboration join owner has an invalid schema");
  }
  if (!Number.isSafeInteger(candidate.senderId) || Number(candidate.senderId) <= 0) {
    throw error(code, "Pending collaboration join sender id is invalid");
  }
  return {
    vaultId: boundedString(candidate.vaultId, "Pending collaboration join VaultId", 256, code) as VaultId,
    senderId: Number(candidate.senderId),
    sessionId: boundedString(
      candidate.sessionId,
      "Pending collaboration join Vault session id",
      256,
      code,
    ) as VaultSessionId,
  };
}

function parsePendingJoinInput(value: unknown): CollaborationPendingJoin {
  const candidate = object(value);
  if (!candidate || !hasExactlyKeys(candidate, PENDING_JOIN_INPUT_KEYS)) {
    throw error("enrollment-invalid", "Pending collaboration join input has an invalid schema");
  }
  return {
    schemaVersion: COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION,
    operationId: normalizedOperationId(candidate.operationId, "enrollment-invalid"),
    owner: parsePendingJoinOwner(candidate.owner, "enrollment-invalid"),
    phase: "opening",
    enrollment: parseInput(candidate.enrollment),
  };
}

function parsePendingJoin(
  value: unknown,
  code: "enrollment-invalid" | "enrollment-corrupt",
): CollaborationPendingJoin {
  const candidate = object(value);
  if (
    !candidate ||
    !hasExactlyKeys(candidate, PENDING_JOIN_KEYS) ||
    candidate.schemaVersion !== COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION ||
    (candidate.phase !== "opening" && candidate.phase !== "enrollment-committed")
  ) {
    throw error(code, "Pending collaboration join has an invalid schema");
  }
  return {
    schemaVersion: COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION,
    operationId: normalizedOperationId(candidate.operationId, code),
    owner: parsePendingJoinOwner(candidate.owner, code),
    phase: candidate.phase,
    enrollment: code === "enrollment-corrupt"
      ? parseStoredRecord(candidate.enrollment)
      : parseRecordInput(candidate.enrollment),
  };
}

function ownerCreationRecord(
  record: CollaborationEnrollmentRecord,
  code: "enrollment-invalid" | "enrollment-corrupt",
): CollaborationPendingCreationRecord {
  if (record.access !== "owner") {
    throw error(code, "Pending collaboration creation access must be owner");
  }
  return record as CollaborationPendingCreationRecord;
}

function parseState(snapshot: PluginStorageSnapshot): StoredEnrollmentState {
  if (snapshot.corrupt) {
    throw error("enrollment-corrupt", "Collaboration enrollment storage is quarantined");
  }
  if (
    typeof snapshot.found !== "boolean" ||
    !Number.isSafeInteger(snapshot.revision) ||
    snapshot.revision < 0
  ) {
    throw error("enrollment-corrupt", "Collaboration enrollment storage envelope is invalid");
  }
  if (!snapshot.found) {
    if (snapshot.data !== null) {
      throw error("enrollment-corrupt", "Missing collaboration enrollment storage contains data");
    }
    return {
      schemaVersion: COLLABORATION_ENROLLMENT_STATE_SCHEMA_VERSION,
      enrollments: [],
      pendingCreations: [],
      identityDeletions: [],
      pathDeletionReservations: [],
      pendingJoins: [],
    };
  }

  const data = object(snapshot.data);
  const legacy = data?.schemaVersion === COLLABORATION_ENROLLMENT_SCHEMA_VERSION;
  const versionTwo = data?.schemaVersion === 2;
  const versionThree = data?.schemaVersion === 3;
  const current = data?.schemaVersion === COLLABORATION_ENROLLMENT_STATE_SCHEMA_VERSION;
  if (!data || (
    legacy
      ? !hasExactlyKeys(data, LEGACY_STATE_KEYS)
      : versionTwo
        ? !hasExactlyKeys(data, V2_STATE_KEYS)
        : versionThree
          ? !hasExactlyKeys(data, V3_STATE_KEYS)
          : !current || !hasExactlyKeys(data, STATE_KEYS)
  ) || !Array.isArray(data.enrollments)) {
    throw error("enrollment-corrupt", "Collaboration enrollment storage is invalid");
  }

  const pendingValues = legacy ? [] : data.pendingCreations;
  const identityDeletionValues = versionThree || current ? data.identityDeletions : [];
  const pathDeletionReservationValues = versionThree || current ? data.pathDeletionReservations : [];
  const pendingJoinValues = current ? data.pendingJoins : [];
  if (
    !Array.isArray(pendingValues) ||
    !Array.isArray(identityDeletionValues) ||
    !Array.isArray(pathDeletionReservationValues) ||
    !Array.isArray(pendingJoinValues) ||
    data.enrollments.length + pendingValues.length +
      identityDeletionValues.length + pathDeletionReservationValues.length +
      pendingJoinValues.length > MAX_ENROLLMENTS
  ) {
    throw error("enrollment-corrupt", "Collaboration enrollment storage is invalid");
  }

  const fileIds = new Set<string>();
  const paths = new Set<string>();
  const documentIds = new Set<string>();
  const parseUniqueRecord = (value: unknown): CollaborationEnrollmentRecord => {
    const enrollment = parseStoredRecord(value);
    const serverDocumentId = `${enrollment.serverUrl}\0${enrollment.documentId}`;
    if (
      fileIds.has(enrollment.fileId) ||
      paths.has(enrollment.path) ||
      documentIds.has(serverDocumentId)
    ) {
      throw error("enrollment-corrupt", "Collaboration enrollment identities must be unique");
    }
    fileIds.add(enrollment.fileId);
    paths.add(enrollment.path);
    documentIds.add(serverDocumentId);
    return enrollment;
  };
  const enrollments = data.enrollments.map(parseUniqueRecord);
  const pendingCreations = pendingValues.map((value) => ownerCreationRecord(
    parseUniqueRecord(value),
    "enrollment-corrupt",
  ));
  const operationIds = new Set<string>();
  const identityDeletions = identityDeletionValues.map((value) => {
    const deletion = parseIdentityDeletion(value, "enrollment-corrupt");
    if (operationIds.has(deletion.operationId)) {
      throw error("enrollment-corrupt", "Collaboration mutation operation ids must be unique");
    }
    operationIds.add(deletion.operationId);
    const record = parseUniqueRecord(deletion.record);
    return { ...deletion, record };
  });
  const pathDeletionReservations = pathDeletionReservationValues.map((value) => {
    const reservation = parsePathDeletionReservation(value, "enrollment-corrupt");
    if (operationIds.has(reservation.operationId)) {
      throw error("enrollment-corrupt", "Collaboration mutation operation ids must be unique");
    }
    operationIds.add(reservation.operationId);
    return reservation;
  });
  const pendingJoins = pendingJoinValues.map((value) => {
    const pending = parsePendingJoin(value, "enrollment-corrupt");
    if (operationIds.has(pending.operationId)) {
      throw error("enrollment-corrupt", "Collaboration mutation operation ids must be unique");
    }
    operationIds.add(pending.operationId);
    if (pending.phase === "enrollment-committed") {
      const enrolled = enrollments.find((entry) => entry.fileId === pending.enrollment.fileId);
      if (!enrolled || !sameRecord(enrolled, pending.enrollment)) {
        throw error(
          "enrollment-corrupt",
          "A committed pending join must match one exact active enrollment",
        );
      }
      return pending;
    }
    const serverDocumentId = `${pending.enrollment.serverUrl}\0${pending.enrollment.documentId}`;
    if (
      fileIds.has(pending.enrollment.fileId) ||
      paths.has(pending.enrollment.path) ||
      documentIds.has(serverDocumentId)
    ) {
      throw error("enrollment-corrupt", "Collaboration enrollment identities must be unique");
    }
    fileIds.add(pending.enrollment.fileId);
    paths.add(pending.enrollment.path);
    documentIds.add(serverDocumentId);
    return pending;
  });
  for (let index = 0; index < pathDeletionReservations.length; index++) {
    const reservation = pathDeletionReservations[index]!;
    if (pathDeletionReservations.slice(index + 1).some((other) => pathsOverlap(
      reservation.path,
      other.path,
    ))) {
      throw error("enrollment-corrupt", "Collaboration path deletion reservations must not overlap");
    }
  }
  return {
    schemaVersion: COLLABORATION_ENROLLMENT_STATE_SCHEMA_VERSION,
    enrollments,
    pendingCreations,
    identityDeletions,
    pathDeletionReservations,
    pendingJoins,
  };
}

function copy<T extends CollaborationEnrollmentRecord>(record: T): T {
  return { ...record };
}

function copyIdentityDeletion(deletion: CollaborationIdentityDeletion): CollaborationIdentityDeletion {
  return { ...deletion, record: copy(deletion.record) };
}

function copyPathDeletionReservation(
  reservation: CollaborationPathDeletionReservation,
): CollaborationPathDeletionReservation {
  return { ...reservation };
}

function copyPendingJoin(pending: CollaborationPendingJoin): CollaborationPendingJoin {
  return {
    ...pending,
    owner: { ...pending.owner },
    enrollment: copy(pending.enrollment),
  };
}

function sameRecord(left: CollaborationEnrollmentRecord, right: CollaborationEnrollmentRecord): boolean {
  return left.fileId === right.fileId &&
    left.path === right.path &&
    left.documentId === right.documentId &&
    left.serverUrl === right.serverUrl &&
    left.access === right.access &&
    left.title === right.title;
}

function sameIdentityDeletion(
  left: CollaborationIdentityDeletion,
  right: CollaborationIdentityDeletion,
): boolean {
  return left.operationId === right.operationId &&
    left.kind === right.kind &&
    sameRecord(left.record, right.record);
}

function samePathDeletionReservation(
  left: CollaborationPathDeletionReservation,
  right: CollaborationPathDeletionReservation,
): boolean {
  return left.operationId === right.operationId && left.path === right.path;
}

function samePendingJoinIdentity(
  left: CollaborationPendingJoin,
  right: CollaborationPendingJoin,
): boolean {
  return left.operationId === right.operationId &&
    left.owner.vaultId === right.owner.vaultId &&
    left.owner.senderId === right.owner.senderId &&
    left.owner.sessionId === right.owner.sessionId &&
    sameRecord(left.enrollment, right.enrollment);
}

function samePendingJoin(left: CollaborationPendingJoin, right: CollaborationPendingJoin): boolean {
  return left.phase === right.phase && samePendingJoinIdentity(left, right);
}

function identityRecords(state: StoredEnrollmentState): CollaborationEnrollmentRecord[] {
  return [
    ...state.enrollments,
    ...state.pendingCreations,
    ...state.identityDeletions.map((deletion) => deletion.record),
    ...state.pendingJoins
      .filter((pending) => pending.phase === "opening")
      .map((pending) => pending.enrollment),
  ];
}

function assertPathNotReserved(
  state: StoredEnrollmentState,
  paths: readonly string[],
  allowedReservationOperationId?: string,
): void {
  if (state.pathDeletionReservations.some((reservation) =>
    reservation.operationId !== allowedReservationOperationId &&
    paths.some((path) => pathWithin(path, reservation.path)))) {
    throw new CollaborationEnrollmentStoreError(
      "enrollment-delete-reserved",
      "A file delete is already reserved for this collaboration path",
    );
  }
}

function assertNoCollision(
  records: readonly CollaborationEnrollmentRecord[],
  candidate: CollaborationEnrollmentRecord,
  replacing?: CollaborationEnrollmentRecord,
): void {
  const collision = records.find((entry) => entry !== replacing && (
    entry.fileId === candidate.fileId ||
    entry.path === candidate.path ||
    (entry.serverUrl === candidate.serverUrl && entry.documentId === candidate.documentId)
  ));
  if (collision) {
    throw new CollaborationEnrollmentStoreError(
      "enrollment-conflict",
      "FileId, path, and the server-scoped DocumentId must identify one unique collaboration enrollment",
    );
  }
}

class CollaborationEnrollmentStoreImpl implements CollaborationEnrollmentStore {
  private readonly pluginId: string;
  private readonly maxSaveAttempts: number;
  private readonly operationIdGenerator: () => string;

  constructor(private readonly options: CollaborationEnrollmentStoreOptions) {
    this.pluginId = boundedString(
      options.pluginId ?? DEFAULT_PLUGIN_ID,
      "Enrollment storage id",
      256,
      "enrollment-invalid",
    );
    const attempts = options.maxSaveAttempts ?? DEFAULT_MAX_SAVE_ATTEMPTS;
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > MAX_SAVE_ATTEMPTS) {
      throw new CollaborationEnrollmentStoreError(
        "enrollment-invalid",
        `maxSaveAttempts must be an integer between 1 and ${MAX_SAVE_ATTEMPTS}`,
      );
    }
    this.maxSaveAttempts = attempts;
    this.operationIdGenerator = options.operationIdGenerator ?? (() => globalThis.crypto.randomUUID());
  }

  private nextOperationId(): string {
    let operationId: unknown;
    try {
      operationId = this.operationIdGenerator();
    } catch (cause) {
      throw new CollaborationEnrollmentStoreError(
        "enrollment-invalid",
        "Could not create an enrollment mutation operation id",
        cause,
      );
    }
    return normalizedOperationId(operationId, "enrollment-invalid");
  }

  async findByPath(path: string): Promise<CollaborationEnrollmentRecord | null> {
    const canonical = normalizedPath(path, "enrollment-invalid");
    const state = await this.load();
    const found = state.enrollments.find((entry) => entry.path === canonical);
    return found ? copy(found) : null;
  }

  async findByFileId(fileId: FileId): Promise<CollaborationEnrollmentRecord | null> {
    const canonical = normalizedFileId(fileId, "enrollment-invalid");
    const state = await this.load();
    const found = state.enrollments.find((entry) => entry.fileId === canonical);
    return found ? copy(found) : null;
  }

  async list(): Promise<readonly CollaborationEnrollmentRecord[]> {
    const state = await this.load();
    return state.enrollments.map(copy);
  }

  async findPendingCreationByPath(path: string): Promise<CollaborationPendingCreationRecord | null> {
    const canonical = normalizedPath(path, "enrollment-invalid");
    const state = await this.load();
    const found = state.pendingCreations.find((entry) => entry.path === canonical);
    return found ? copy(found) : null;
  }

  async listPendingCreations(): Promise<readonly CollaborationPendingCreationRecord[]> {
    const state = await this.load();
    return state.pendingCreations.map(copy);
  }

  async listIdentityDeletions(): Promise<readonly CollaborationIdentityDeletion[]> {
    const state = await this.load();
    return state.identityDeletions.map(copyIdentityDeletion);
  }

  async listDeletionReservations(): Promise<readonly CollaborationPathDeletionReservation[]> {
    const state = await this.load();
    return state.pathDeletionReservations.map(copyPathDeletionReservation);
  }

  async listPendingJoins(): Promise<readonly CollaborationPendingJoin[]> {
    const state = await this.load();
    return state.pendingJoins.map(copyPendingJoin);
  }

  async assertProjectionWriteAuthorized(
    identity: Pick<CollaborationEnrollmentInput, "fileId" | "path" | "documentId">,
    options: { readonly openingOperationId?: string } = {},
  ): Promise<void> {
    const candidate = {
      fileId: normalizedFileId(identity.fileId, "enrollment-invalid"),
      path: normalizedPath(identity.path, "enrollment-invalid"),
      documentId: normalizedDocumentId(identity.documentId, "enrollment-invalid"),
    };
    const state = await this.load();
    assertPathNotReserved(state, [candidate.path]);
    const live = [...state.enrollments, ...state.pendingCreations].find((record) =>
      record.fileId === candidate.fileId &&
      record.path === candidate.path &&
      record.documentId === candidate.documentId);
    if (live) return;
    const openingOperationId = options.openingOperationId === undefined
      ? undefined
      : normalizedOperationId(options.openingOperationId, "enrollment-invalid");
    const pendingJoin = state.pendingJoins.find((pending) =>
      pending.phase === "opening" &&
      pending.operationId === openingOperationId &&
      pending.enrollment.fileId === candidate.fileId &&
      pending.enrollment.path === candidate.path &&
      pending.enrollment.documentId === candidate.documentId);
    if (pendingJoin) return;
    throw new CollaborationEnrollmentStoreError(
      "projection-identity-unavailable",
      "The collaboration projection no longer has an exact live enrollment identity",
    );
  }

  async beginJoin(input: CollaborationPendingJoinInput): Promise<CollaborationPendingJoin> {
    const pending = parsePendingJoinInput(input);
    return this.mutate((state) => {
      assertPathNotReserved(state, [pending.enrollment.path]);
      const existing = state.pendingJoins.find((candidate) =>
        candidate.operationId === pending.operationId);
      if (existing) {
        if (samePendingJoin(existing, pending)) {
          return { state, result: copyPendingJoin(existing), changed: false };
        }
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The pending join operation id is already assigned",
        );
      }
      if (
        state.identityDeletions.some((candidate) => candidate.operationId === pending.operationId) ||
        state.pathDeletionReservations.some((candidate) => candidate.operationId === pending.operationId)
      ) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The pending join operation id is already assigned",
        );
      }
      assertNoCollision(identityRecords(state), pending.enrollment);
      return {
        state: { ...state, pendingJoins: [...state.pendingJoins, pending] },
        result: copyPendingJoin(pending),
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async commitJoin(intentValue: CollaborationPendingJoin): Promise<CollaborationPendingJoin> {
    const intent = parsePendingJoin(intentValue, "enrollment-invalid");
    return this.mutate((state) => {
      assertPathNotReserved(state, [intent.enrollment.path]);
      const index = state.pendingJoins.findIndex((candidate) =>
        candidate.operationId === intent.operationId);
      if (index < 0) {
        const enrolled = state.enrollments.find((candidate) =>
          candidate.fileId === intent.enrollment.fileId);
        if (enrolled && sameRecord(enrolled, intent.enrollment)) {
          return {
            state,
            result: copyPendingJoin({ ...intent, phase: "enrollment-committed" }),
            changed: false,
          };
        }
        throw new CollaborationEnrollmentStoreError(
          "enrollment-not-found",
          "The durable pending join intent no longer exists",
        );
      }
      const current = state.pendingJoins[index]!;
      if (!samePendingJoinIdentity(current, intent)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The durable pending join does not match the supplied intent",
        );
      }
      if (current.phase === "enrollment-committed") {
        return { state, result: copyPendingJoin(current), changed: false };
      }
      assertNoCollision(identityRecords(state), current.enrollment, current.enrollment);
      const committed: CollaborationPendingJoin = { ...current, phase: "enrollment-committed" };
      const pendingJoins = [...state.pendingJoins];
      pendingJoins[index] = committed;
      return {
        state: {
          ...state,
          enrollments: [...state.enrollments, current.enrollment],
          pendingJoins,
        },
        result: copyPendingJoin(committed),
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async completeJoin(intentValue: CollaborationPendingJoin): Promise<boolean> {
    const intent = parsePendingJoin(intentValue, "enrollment-invalid");
    if (intent.phase !== "enrollment-committed") {
      throw new CollaborationEnrollmentStoreError(
        "enrollment-conflict",
        "Only an enrollment-committed pending join can be completed",
      );
    }
    return this.mutate((state) => {
      const index = state.pendingJoins.findIndex((candidate) =>
        candidate.operationId === intent.operationId);
      if (index < 0) return { state, result: false, changed: false };
      const current = state.pendingJoins[index]!;
      if (!samePendingJoin(current, intent)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The pending join changed before completion",
        );
      }
      const enrolled = state.enrollments.find((candidate) =>
        candidate.fileId === intent.enrollment.fileId);
      if (!enrolled || !sameRecord(enrolled, intent.enrollment)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The pending join Enrollment is unavailable",
        );
      }
      return {
        state: {
          ...state,
          pendingJoins: state.pendingJoins.filter((_, candidateIndex) => candidateIndex !== index),
        },
        result: true,
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async abortJoin(intentValue: CollaborationPendingJoin): Promise<boolean> {
    const intent = parsePendingJoin(intentValue, "enrollment-invalid");
    if (intent.phase !== "opening") {
      throw new CollaborationEnrollmentStoreError(
        "enrollment-conflict",
        "An enrollment-committed pending join cannot be aborted",
      );
    }
    return this.mutate((state) => {
      const index = state.pendingJoins.findIndex((candidate) =>
        candidate.operationId === intent.operationId);
      if (index < 0) return { state, result: false, changed: false };
      const current = state.pendingJoins[index]!;
      if (!samePendingJoin(current, intent)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The pending join changed before abort",
        );
      }
      return {
        state: {
          ...state,
          pendingJoins: state.pendingJoins.filter((_, candidateIndex) => candidateIndex !== index),
        },
        result: true,
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async beginCreation(
    input: CollaborationEnrollmentInput & { readonly access: "owner" },
  ): Promise<CollaborationPendingCreationRecord> {
    const candidate = ownerCreationRecord(parseInput(input), "enrollment-invalid");
    return this.mutate((state) => {
      assertPathNotReserved(state, [candidate.path]);
      const existing = state.pendingCreations.find((entry) => entry.fileId === candidate.fileId);
      if (existing) {
        if (sameRecord(existing, candidate)) {
          return { state, result: copy(existing), changed: false };
        }
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "A pending FileId cannot be reassigned to another collaboration identity",
        );
      }
      assertNoCollision(identityRecords(state), candidate);
      return {
        state: {
          ...state,
          pendingCreations: [...state.pendingCreations, candidate],
        },
        result: copy(candidate),
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async commitCreation(intent: CollaborationPendingCreationRecord): Promise<CollaborationEnrollmentRecord> {
    const candidate = ownerCreationRecord(parseRecordInput(intent), "enrollment-invalid");
    return this.mutate((state) => {
      assertPathNotReserved(state, [candidate.path]);
      const pendingIndex = state.pendingCreations.findIndex((entry) => entry.fileId === candidate.fileId);
      if (pendingIndex < 0) {
        const committed = state.enrollments.find((entry) => entry.fileId === candidate.fileId);
        if (committed && sameRecord(committed, candidate)) {
          return { state, result: copy(committed), changed: false };
        }
        if (committed) {
          throw new CollaborationEnrollmentStoreError(
            "enrollment-conflict",
            "The committed enrollment does not match the pending creation intent",
          );
        }
        throw new CollaborationEnrollmentStoreError(
          "enrollment-not-found",
          `No pending collaboration creation exists for FileId ${candidate.fileId}`,
        );
      }
      const pending = state.pendingCreations[pendingIndex]!;
      if (!sameRecord(pending, candidate)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The durable pending creation does not match the supplied intent",
        );
      }
      assertNoCollision(identityRecords(state), pending, pending);
      return {
        state: {
          ...state,
          enrollments: [...state.enrollments, pending],
          pendingCreations: state.pendingCreations.filter((_, index) => index !== pendingIndex),
        },
        result: copy(pending),
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async forgetPendingCreation(
    expectedValue: CollaborationPendingCreationRecord,
  ): Promise<CollaborationIdentityDeletion | null> {
    const expected = ownerCreationRecord(parseRecordInput(expectedValue), "enrollment-invalid");
    return this.beginIdentityDeletion("pending-creation", expected);
  }

  async upsert(input: CollaborationEnrollmentInput): Promise<CollaborationEnrollmentRecord> {
    const candidate = parseInput(input);
    return this.mutate((state) => {
      assertPathNotReserved(state, [candidate.path]);
      const index = state.enrollments.findIndex((entry) => entry.fileId === candidate.fileId);
      const previous = index < 0 ? undefined : state.enrollments[index]!;
      const recoveringJoin = state.pendingJoins.find((pending) =>
        pending.enrollment.fileId === candidate.fileId);
      if (recoveringJoin && (!previous || !sameRecord(recoveringJoin.enrollment, candidate))) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "Finish pending join recovery before changing its Enrollment",
        );
      }
      if (previous && (
        previous.documentId !== candidate.documentId || previous.serverUrl !== candidate.serverUrl
      )) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "A stable FileId cannot be reassigned to another server document",
        );
      }
      assertNoCollision(identityRecords(state), candidate, previous);
      if (previous && sameRecord(previous, candidate)) {
        return { state, result: copy(previous), changed: false };
      }
      const enrollments = [...state.enrollments];
      if (index < 0) enrollments.push(candidate);
      else enrollments[index] = candidate;
      return { state: { ...state, enrollments }, result: copy(candidate), changed: true };
    });
  }

  async rename(
    expectedValue: CollaborationEnrollmentRecord,
    path: string,
    title?: string,
  ): Promise<CollaborationEnrollmentRecord> {
    const expected = parseRecordInput(expectedValue);
    const canonicalPath = normalizedPath(path, "enrollment-invalid");
    const canonicalTitle = title === undefined
      ? undefined
      : boundedString(title, "Enrollment title", MAX_TITLE_LENGTH, "enrollment-invalid");
    return this.mutate((state) => {
      const enrollmentIndex = state.enrollments.findIndex((entry) => entry.fileId === expected.fileId);
      const pendingIndex = state.pendingCreations.findIndex((entry) => entry.fileId === expected.fileId);
      const previous = enrollmentIndex >= 0
        ? state.enrollments[enrollmentIndex]!
        : pendingIndex >= 0
          ? state.pendingCreations[pendingIndex]!
          : undefined;
      if (!previous) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-not-found",
          `No collaboration enrollment or pending creation exists for FileId ${expected.fileId}`,
        );
      }
      if (!sameRecord(previous, expected)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The collaboration identity changed before rename",
        );
      }
      if (state.pendingJoins.some((pending) => pending.enrollment.fileId === expected.fileId)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "Finish pending join recovery before renaming its Enrollment",
        );
      }
      const renamed = {
        ...previous,
        path: canonicalPath,
        ...(canonicalTitle === undefined ? {} : { title: canonicalTitle }),
      };
      assertPathNotReserved(state, [previous.path, renamed.path]);
      assertNoCollision(identityRecords(state), renamed, previous);
      if (sameRecord(previous, renamed)) {
        return { state, result: copy(previous), changed: false };
      }
      if (enrollmentIndex >= 0) {
        const enrollments = [...state.enrollments];
        enrollments[enrollmentIndex] = renamed;
        return { state: { ...state, enrollments }, result: copy(renamed), changed: true };
      }
      const pendingCreations = [...state.pendingCreations];
      const renamedPending: CollaborationPendingCreationRecord = {
        ...state.pendingCreations[pendingIndex]!,
        path: canonicalPath,
        ...(canonicalTitle === undefined ? {} : { title: canonicalTitle }),
      };
      pendingCreations[pendingIndex] = renamedPending;
      return { state: { ...state, pendingCreations }, result: copy(renamedPending), changed: true };
    });
  }

  async forget(expectedValue: CollaborationEnrollmentRecord): Promise<CollaborationIdentityDeletion | null> {
    return this.beginIdentityDeletion("enrollment", parseRecordInput(expectedValue));
  }

  async restoreForget(
    deletionValue: CollaborationIdentityDeletion,
    reservationValue?: CollaborationPathDeletionReservation,
  ): Promise<CollaborationEnrollmentRecord> {
    const deletion = parseIdentityDeletion(deletionValue, "enrollment-invalid");
    const reservation = reservationValue
      ? parsePathDeletionReservation(reservationValue, "enrollment-invalid")
      : undefined;
    return this.mutate((state) => {
      const deletionIndex = state.identityDeletions.findIndex(
        (candidate) => candidate.operationId === deletion.operationId,
      );
      if (deletionIndex < 0) {
        const current = identityRecords(state).find((record) => record.fileId === deletion.record.fileId);
        if (current && sameRecord(current, deletion.record)) return {
          state,
          result: copy(current),
          changed: false,
        };
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The collaboration identity is no longer in this delete operation",
        );
      }
      const currentDeletion = state.identityDeletions[deletionIndex]!;
      if (!sameIdentityDeletion(currentDeletion, deletion)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The collaboration identity deletion changed before rollback",
        );
      }
      if (reservation) {
        const currentReservation = state.pathDeletionReservations.find(
          (candidate) => candidate.operationId === reservation.operationId,
        );
        if (!currentReservation ||
          !samePathDeletionReservation(currentReservation, reservation) ||
          !pathWithin(deletion.record.path, reservation.path)) {
          throw new CollaborationEnrollmentStoreError(
            "enrollment-conflict",
            "The file deletion reservation cannot authorize this identity rollback",
          );
        }
      }
      assertPathNotReserved(state, [deletion.record.path], reservation?.operationId);
      assertNoCollision(identityRecords(state), deletion.record, currentDeletion.record);
      const identityDeletions = state.identityDeletions.filter((_, index) => index !== deletionIndex);
      if (deletion.kind === "enrollment") {
        return {
          state: {
            ...state,
            enrollments: [...state.enrollments, deletion.record],
            identityDeletions,
          },
          result: copy(deletion.record),
          changed: true,
        };
      }
      const pending = ownerCreationRecord(deletion.record, "enrollment-invalid");
      return {
        state: {
          ...state,
          pendingCreations: [...state.pendingCreations, pending],
          identityDeletions,
        },
        result: copy(pending),
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async completeForget(deletionValue: CollaborationIdentityDeletion): Promise<boolean> {
    const deletion = parseIdentityDeletion(deletionValue, "enrollment-invalid");
    return this.mutate((state) => {
      const index = state.identityDeletions.findIndex(
        (candidate) => candidate.operationId === deletion.operationId,
      );
      if (index < 0) return { state, result: false, changed: false };
      if (!sameIdentityDeletion(state.identityDeletions[index]!, deletion)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The collaboration identity deletion changed before completion",
        );
      }
      return {
        state: {
          ...state,
          identityDeletions: state.identityDeletions.filter((_, candidateIndex) => candidateIndex !== index),
        },
        result: true,
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async reserveDeletion(path: string, requestedOperationId?: string): Promise<CollaborationPathDeletionReservation> {
    const canonicalPath = normalizedPath(path, "enrollment-invalid");
    const reservation: CollaborationPathDeletionReservation = {
      schemaVersion: COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION,
      operationId: requestedOperationId === undefined
        ? this.nextOperationId()
        : normalizedOperationId(requestedOperationId, "enrollment-invalid"),
      path: canonicalPath,
    };
    return this.mutate((state) => {
      const existingOperation = state.pathDeletionReservations.find(
        (candidate) => candidate.operationId === reservation.operationId,
      );
      if (existingOperation) {
        if (samePathDeletionReservation(existingOperation, reservation)) {
          return { state, result: copyPathDeletionReservation(existingOperation), changed: false };
        }
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The deletion operation id is already assigned",
        );
      }
      if (state.identityDeletions.some((candidate) =>
        candidate.operationId === reservation.operationId)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The deletion operation id is already assigned",
        );
      }
      if (state.pendingJoins.some((candidate) =>
        candidate.operationId === reservation.operationId)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The deletion operation id is already assigned",
        );
      }
      if (state.pendingCreations.some((record) => pathWithin(record.path, canonicalPath))) {
        throw new CollaborationEnrollmentStoreError(
          "pending-creation-delete-blocked",
          "Recover or abandon the pending collaboration creation before deleting this path",
        );
      }
      if (state.pendingJoins.some((pending) =>
        pathWithin(pending.enrollment.path, canonicalPath))) {
        throw new CollaborationEnrollmentStoreError(
          "pending-join-delete-blocked",
          "Recover or safely abort the pending collaboration join before deleting this path",
        );
      }
      if (state.identityDeletions.some((deletion) => pathWithin(deletion.record.path, canonicalPath))) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "Finish the collaboration identity cleanup before deleting this path",
        );
      }
      if (state.pathDeletionReservations.some((candidate) => pathsOverlap(candidate.path, canonicalPath))) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-delete-reserved",
          "An overlapping file delete is already reserved",
        );
      }
      return {
        state: {
          ...state,
          pathDeletionReservations: [...state.pathDeletionReservations, reservation],
        },
        result: copyPathDeletionReservation(reservation),
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  async releaseDeletion(
    reservationValue: CollaborationPathDeletionReservation,
  ): Promise<boolean> {
    const reservation = parsePathDeletionReservation(reservationValue, "enrollment-invalid");
    return this.mutate((state) => {
      const index = state.pathDeletionReservations.findIndex(
        (candidate) => candidate.operationId === reservation.operationId,
      );
      if (index < 0) return { state, result: false, changed: false };
      if (!samePathDeletionReservation(state.pathDeletionReservations[index]!, reservation)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The path deletion reservation changed before release",
        );
      }
      return {
        state: {
          ...state,
          pathDeletionReservations: state.pathDeletionReservations.filter(
            (_, candidateIndex) => candidateIndex !== index,
          ),
        },
        result: true,
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  private beginIdentityDeletion(
    kind: CollaborationIdentityDeletion["kind"],
    expected: CollaborationEnrollmentRecord,
  ): Promise<CollaborationIdentityDeletion | null> {
    const deletion: CollaborationIdentityDeletion = {
      schemaVersion: COLLABORATION_ENROLLMENT_MUTATION_SCHEMA_VERSION,
      operationId: this.nextOperationId(),
      kind,
      record: copy(expected),
    };
    return this.mutate((state) => {
      const existingDeletion = state.identityDeletions.find(
        (candidate) => candidate.operationId === deletion.operationId,
      );
      if (existingDeletion) {
        if (sameIdentityDeletion(existingDeletion, deletion)) {
          return { state, result: copyIdentityDeletion(existingDeletion), changed: false };
        }
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The deletion operation id is already assigned",
        );
      }
      if (state.pathDeletionReservations.some((candidate) =>
        candidate.operationId === deletion.operationId)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The deletion operation id is already assigned",
        );
      }
      if (state.pendingJoins.some((candidate) =>
        candidate.operationId === deletion.operationId)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The deletion operation id is already assigned",
        );
      }
      if (state.pendingJoins.some((pending) =>
        pending.enrollment.fileId === expected.fileId)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "Finish pending join recovery before deleting its Enrollment",
        );
      }
      const records = kind === "enrollment" ? state.enrollments : state.pendingCreations;
      const index = records.findIndex((entry) => entry.fileId === expected.fileId);
      if (index < 0) return { state, result: null, changed: false };
      if (!sameRecord(records[index]!, expected)) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-conflict",
          "The collaboration identity changed before delete",
        );
      }
      return {
        state: {
          ...state,
          ...(kind === "enrollment"
            ? { enrollments: state.enrollments.filter((_, candidateIndex) => candidateIndex !== index) }
            : { pendingCreations: state.pendingCreations.filter((_, candidateIndex) => candidateIndex !== index) }),
          identityDeletions: [...state.identityDeletions, deletion],
        },
        result: copyIdentityDeletion(deletion),
        changed: true,
      };
    }, { reconcileAfterWriteFailure: true });
  }

  private async load(): Promise<StoredEnrollmentState> {
    try {
      return parseState(await this.options.bridge.storage.load(this.pluginId));
    } catch (cause) {
      if (cause instanceof CollaborationEnrollmentStoreError) throw cause;
      throw new CollaborationEnrollmentStoreError(
        "enrollment-read-failed",
        "Could not read collaboration enrollments",
        cause,
      );
    }
  }

  private async mutate<T>(
    mutation: (current: StoredEnrollmentState) => Mutation<T>,
    options: { readonly reconcileAfterWriteFailure?: boolean } = {},
  ): Promise<T> {
    for (let attempt = 0; attempt < this.maxSaveAttempts; attempt++) {
      let snapshot: PluginStorageSnapshot;
      let state: StoredEnrollmentState;
      try {
        snapshot = await this.options.bridge.storage.load(this.pluginId);
        state = parseState(snapshot);
      } catch (cause) {
        if (cause instanceof CollaborationEnrollmentStoreError) throw cause;
        throw new CollaborationEnrollmentStoreError(
          "enrollment-read-failed",
          "Could not read collaboration enrollments",
          cause,
        );
      }
      const next = mutation(state);
      if (!next.changed) return next.result;
      if (
        next.state.enrollments.length + next.state.pendingCreations.length +
          next.state.identityDeletions.length + next.state.pathDeletionReservations.length +
          next.state.pendingJoins.length > MAX_ENROLLMENTS
      ) {
        throw new CollaborationEnrollmentStoreError(
          "enrollment-write-failed",
          `Collaboration enrollment storage cannot exceed ${MAX_ENROLLMENTS} entries`,
        );
      }
      try {
        const saved = await this.options.bridge.storage.save(this.pluginId, snapshot.revision, {
          schemaVersion: COLLABORATION_ENROLLMENT_STATE_SCHEMA_VERSION,
          enrollments: next.state.enrollments,
          pendingCreations: next.state.pendingCreations,
          identityDeletions: next.state.identityDeletions,
          pathDeletionReservations: next.state.pathDeletionReservations,
          pendingJoins: next.state.pendingJoins,
        } satisfies StoredEnrollmentState);
        if (saved.ok) return next.result;
      } catch (cause) {
        if (options.reconcileAfterWriteFailure) {
          try {
            const after = parseState(await this.options.bridge.storage.load(this.pluginId));
            const reconciled = mutation(after);
            if (!reconciled.changed) return reconciled.result;
          } catch {
            // Preserve the original ambiguous write failure when read-back
            // cannot prove that this exact intent was committed.
          }
        }
        throw new CollaborationEnrollmentStoreError(
          "enrollment-write-failed",
          "Could not persist collaboration enrollments",
          cause,
        );
      }
    }
    if (options.reconcileAfterWriteFailure) {
      try {
        const reconciled = mutation(await this.load());
        if (!reconciled.changed) return reconciled.result;
      } catch {
        // Bounded contention remains a write failure unless read-back proves
        // that this exact idempotent mutation already committed.
      }
    }
    throw new CollaborationEnrollmentStoreError(
      "enrollment-write-failed",
      "Collaboration enrollments remained busy after bounded retries",
    );
  }
}

export function createCollaborationEnrollmentStore(
  options: CollaborationEnrollmentStoreOptions,
): CollaborationEnrollmentStore {
  return new CollaborationEnrollmentStoreImpl(options);
}
