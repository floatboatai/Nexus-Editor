import * as Y from "yjs";

import { CollaborationError, type CollabDocumentRef } from "./types";

export const COLLAB_SCHEMA_VERSION = 1;
export const CONTENT_KEY = "content";
export const META_KEY = "nexus:meta";

const SCHEMA_ORIGIN = Object.freeze({ kind: "nexus-collab-schema" });

export interface CollabSchema {
  readonly text: Y.Text;
  readonly meta: Y.Map<unknown>;
}

export function getSchema(doc: Y.Doc): CollabSchema {
  return {
    text: doc.getText(CONTENT_KEY),
    meta: doc.getMap(META_KEY),
  };
}

export function schemaCreated(schema: CollabSchema): boolean {
  return schema.meta.get("created") === true;
}

export function validateSchema(schema: CollabSchema, ref: CollabDocumentRef): "empty" | "created" {
  if (schema.meta.size === 0 && schema.text.length === 0) return "empty";
  const version = schema.meta.get("schemaVersion");
  const id = schema.meta.get("documentId");
  const hostIdentity = schema.meta.get("hostIdentity");
  if (version !== COLLAB_SCHEMA_VERSION || typeof id !== "string") {
    throw new CollaborationError("schema-mismatch", "Collaborative document metadata is incomplete or unsupported");
  }
  if (id !== ref.id || (hostIdentity ?? undefined) !== ref.hostIdentity) {
    throw new CollaborationError(
      "document-identity-mismatch",
      `Collaborative document identity does not match ${ref.id}`,
    );
  }
  if (!schemaCreated(schema)) {
    throw new CollaborationError("schema-mismatch", "Collaborative document has no creation marker");
  }
  return "created";
}

export function createSchema(doc: Y.Doc, schema: CollabSchema, ref: CollabDocumentRef, markdown: string): void {
  if (schema.meta.size > 0 || schema.text.length > 0) {
    throw new CollaborationError("document-already-exists", `Collaborative document ${ref.id} already exists`);
  }
  doc.transact(() => {
    schema.meta.set("schemaVersion", COLLAB_SCHEMA_VERSION);
    schema.meta.set("documentId", ref.id);
    if (ref.hostIdentity !== undefined) schema.meta.set("hostIdentity", ref.hostIdentity);
    schema.meta.set("created", true);
    schema.meta.set("createdAt", new Date().toISOString());
    if (markdown.length > 0) schema.text.insert(0, markdown.replace(/\r\n?/g, "\n"));
  }, SCHEMA_ORIGIN);
}
