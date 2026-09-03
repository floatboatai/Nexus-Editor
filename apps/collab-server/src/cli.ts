import { pathToFileURL } from "node:url";

import { createCollaborationServer } from "./server";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

export function parseInvitationAllowedOrigins(
  value: string | undefined,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (value.trim().length === 0) return Object.freeze([]);
  const origins = value.split(",").map((origin) => origin.trim());
  if (origins.some((origin) => origin.length === 0)) {
    throw new Error("NEXUS_COLLAB_INVITATION_ORIGINS must not contain empty entries");
  }
  return Object.freeze(origins);
}

export function parseIssuedTokenLifetime(value: string | undefined): number {
  return integer(value, 3_600, "--ttl");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  const server = createCollaborationServer({
    address: process.env.NEXUS_COLLAB_ADDRESS ?? "127.0.0.1",
    port: integer(process.env.NEXUS_COLLAB_PORT, 1234, "NEXUS_COLLAB_PORT"),
    storageDirectory: requiredEnvironment("NEXUS_COLLAB_STORAGE_DIR"),
    authSecret: requiredEnvironment("NEXUS_COLLAB_AUTH_SECRET"),
    maxDocumentBytes: integer(
      process.env.NEXUS_COLLAB_MAX_DOCUMENT_BYTES,
      8 * 1024 * 1024,
      "NEXUS_COLLAB_MAX_DOCUMENT_BYTES",
    ),
    maxAuthenticatedQueueBytes: integer(
      process.env.NEXUS_COLLAB_MAX_AUTHENTICATED_QUEUE_BYTES,
      2 * 1024 * 1024,
      "NEXUS_COLLAB_MAX_AUTHENTICATED_QUEUE_BYTES",
    ),
    maxAuthenticatedQueueMessages: integer(
      process.env.NEXUS_COLLAB_MAX_AUTHENTICATED_QUEUE_MESSAGES,
      8,
      "NEXUS_COLLAB_MAX_AUTHENTICATED_QUEUE_MESSAGES",
    ),
    invitationMaximumLifetimeSeconds: integer(
      process.env.NEXUS_COLLAB_INVITATION_MAX_TTL,
      900,
      "NEXUS_COLLAB_INVITATION_MAX_TTL",
    ),
    invitationAllowedOrigins: parseInvitationAllowedOrigins(
      process.env.NEXUS_COLLAB_INVITATION_ORIGINS,
    ),
  });

  if (command === "issue-token") {
    const role = option("role") ?? "editor";
    if (role !== "reader" && role !== "editor") throw new Error("--role must be reader or editor");
    const issued = await server.tokens.issue({
      documentId: option("document") ?? requiredEnvironment("NEXUS_COLLAB_DOCUMENT_ID"),
      userId: option("user") ?? requiredEnvironment("NEXUS_COLLAB_USER_ID"),
      role,
      lifetimeSeconds: parseIssuedTokenLifetime(option("ttl")),
    });
    process.stdout.write(`${JSON.stringify(issued)}\n`);
    return;
  }

  if (command !== "serve") throw new Error(`Unknown command: ${command}`);
  await server.start();
  process.stdout.write(`Nexus collaboration server listening at ${server.websocketUrl}\n`);
  const stop = async () => {
    await server.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((cause) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`Nexus collaboration server failed: ${message}\n`);
    process.exitCode = 1;
  });
}
