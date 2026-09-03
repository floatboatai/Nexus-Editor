import {
  asDocumentId,
  type DocumentId,
  type ReplicaStore,
  type ReplicaStoreLease,
} from "@floatboat/nexus-plugin-collab";

const STORAGE_KEY_DOMAIN = "nexus-collaboration-replica-v2";

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function storageKey(serverUrl: string, documentId: DocumentId): Promise<DocumentId> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Secure hashing is unavailable for collaboration storage isolation");
  const material = new TextEncoder().encode(`${STORAGE_KEY_DOMAIN}\0${serverUrl}\0${documentId}`);
  const digest = await subtle.digest("SHA-256", material);
  return asDocumentId(`v2.${hex(digest)}`);
}

/**
 * Partitions a shared Host Store by the canonical Provider URL as well as the
 * remote DocumentId. Version 1 used the bare DocumentId; those ambiguous rows
 * are intentionally left quarantined instead of being attached to an
 * arbitrary server during migration.
 */
export function createServerScopedReplicaStore(
  store: ReplicaStore,
  canonicalServerUrl: string,
): ReplicaStore {
  return Object.freeze({
    async open(documentId: DocumentId): Promise<ReplicaStoreLease> {
      return store.open(await storageKey(canonicalServerUrl, documentId));
    },
  });
}
