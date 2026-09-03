# Nexus collaboration reference server

This app is a runnable authenticated Hocuspocus deployment for Nexus collaborative documents. It supplies the first real network adapter qualification path: WebSocket synchronization, room-scoped reader/editor credentials, live revocation, bounded frames, and durable binary Yjs snapshots.

It is a **reference deployment**, not a claim that this repository operates a production cloud service. A production Host still owns TLS termination, account/session issuance, secret rotation, backup/restore, monitoring, data retention, horizontal scaling, and capacity SLOs.

## Requirements

- Node.js 22 or newer
- a private directory writable only by the service account
- a random authentication secret of at least 32 bytes
- TLS termination in front of the server for any non-local deployment

For a Linux single-node deployment, use the [systemd + Nginx runbook](./deploy/README.md). It includes a non-root service, protected signing credential, explicit invitation policy, private persistent data, TLS/WebSocket proxy, stop/backup/restore procedure, and acceptance checks. These are operator-applied templates, not a managed service or evidence of production qualification.

Runtime dependencies are pinned to `@hocuspocus/server@4.6.0` and `yjs@13.6.32`. Both are MIT licensed. The browser adapter is exported separately as `@floatboat/nexus-plugin-collab/hocuspocus` and uses `@hocuspocus/provider@4.6.0` (MIT); the ordinary collaboration Engine entry remains server-SDK-free.

## Run locally

```bash
export NEXUS_COLLAB_AUTH_SECRET="$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("base64url"))')"
export NEXUS_COLLAB_STORAGE_DIR="/tmp/nexus-collab-data"
export NEXUS_COLLAB_ADDRESS="127.0.0.1"
export NEXUS_COLLAB_PORT="1234"
export NEXUS_COLLAB_MAX_DOCUMENT_BYTES="8388608"
export NEXUS_COLLAB_MAX_AUTHENTICATED_QUEUE_BYTES="2097152"
export NEXUS_COLLAB_MAX_AUTHENTICATED_QUEUE_MESSAGES="8"
export NEXUS_COLLAB_INVITATION_MAX_TTL="900"
export NEXUS_COLLAB_INVITATION_ORIGINS=""
pnpm --filter @floatboat/nexus-collab-server dev
```

Generate a fresh secret once for each deployment and retain it across server restarts and token-issuing terminals. Re-running the generation line replaces the key and invalidates existing tokens. The server rejects the public documentation placeholder so a copied example cannot silently become a forgeable signing key. The CLI reads process environment only: placing a `.env` file beside it does not load that file. Export settings explicitly, use Node's `--env-file` with the built CLI, or use the deployment unit's explicit `EnvironmentFile` and `LoadCredential` configuration. Never commit a populated environment file.

Health and readiness probes are available at `/healthz` and `/readyz`. Both currently return the same process-level response; `/readyz` does not independently prove disk health, persisted revisions, or successful authentication. The collaboration endpoint uses the same origin over WebSocket.

Issue a short-lived room credential from the trusted Host side:

```bash
pnpm --filter @floatboat/nexus-collab-server dev issue-token \
  --document document-018f \
  --user user-42 \
  --role editor \
  --ttl 3600
```

Keep the server running and issue the credential from another trusted Host terminal that has the exact same `NEXUS_COLLAB_AUTH_SECRET`. The trusted-host CLI defaults `--ttl` to 3600 seconds. `reader` credentials receive document and Presence updates but cannot submit document updates. `editor` credentials can submit updates. Tokens are HMAC-SHA256 signed, audience/issuer checked, room-scoped, time-bounded, and identified by a revocable token ID. Never put the signing secret in a renderer or browser bundle.

Start the reference client in another terminal:

```bash
pnpm dev:electron-demo
```

The command uses the runtime Host by default. Set `NEXUS_PLUGIN_PLATFORM=0` only to exercise the legacy compatibility Host; that path is not the collaboration product entry. To trust a remote server, start the client with `NEXUS_COLLAB_SERVERS="wss://collab.example.com"`; enter that same server URL in the collaboration panel. This is a client Host allowlist, not the server's bind address or invitation CORS configuration. Non-loopback connections require WSS with a certificate trusted by the client; do not disable certificate verification. Electron Main brokers invitation HTTP requests without an `Origin` header, so the server's invitation Origin allowlist can stay explicitly empty. The built renderer is served from the secure `nexus-app://editor/` origin with an enforced Host-generated CSP; it does not issue invitation HTTP requests directly.

An authenticated editor can delegate a short-lived credential for the same document without receiving the signing secret:

```http
POST /v1/invitations HTTP/1.1
Authorization: Bearer <current-editor-token>
Content-Type: application/json

{
  "documentId": "document-018f",
  "userId": "user-84",
  "role": "reader",
  "lifetimeSeconds": 300
}
```

The Electron reference Host requests a five-minute invitation by default; the server's default invitation TTL ceiling is 15 minutes. The response is a `201` token envelope containing `token`, `tokenId`, `expiresAt`, `documentId`, `userId`, and `role`, with `Cache-Control: no-store`. The request body is limited to 4 KiB, and a delegated credential may never outlive its editor credential. Keep enough remaining lifetime on the editor credential before delegating: a 403 `delegation-outlives-authority` response is expected when the requested invitation would cross that boundary, and the product asks the user to reauthenticate instead of weakening it. The endpoint rejects query parameters so a bearer token is never accepted in a URL. Keep the bearer token in the `Authorization` header and redact that header in any reverse-proxy logs.

### Invitation Origin policy

Electron Main sends invitation requests through its trusted-server broker; it does not forward the renderer's opaque `null` Origin. Browser-only Hosts that directly fetch the invitation endpoint must instead configure their exact HTTPS origin. `NEXUS_COLLAB_INVITATION_ORIGINS` is a comma-separated allowlist containing exact HTTP(S) origins and, for isolated legacy loopback testing only, the literal `null`. Wildcards, URL credentials, paths, query strings, fragments, and non-HTTP(S) schemes are rejected. For example:

```bash
# Optional direct-fetch legacy tests on loopback only; not required by Electron Main
export NEXUS_COLLAB_INVITATION_ORIGINS="http://localhost:5173,null"

# Hosted renderer; multiple exact origins may be listed
export NEXUS_COLLAB_INVITATION_ORIGINS="https://editor.example.com,https://staging-editor.example.com"

# Explicitly disable every Origin-bearing invitation request
export NEXUS_COLLAB_INVITATION_ORIGINS=""
```

When the variable is unset, `null` is allowed only if the server listens on a loopback address; a non-loopback listener defaults to an empty allowlist. **A public reverse proxy does not change this listener check:** a backend listening on `127.0.0.1` behind TLS must explicitly set this variable to empty (Electron Main/server-side clients), or to the exact HTTPS browser origins it supports. Requests without an `Origin` header remain subject to bearer authentication. Absence of Origin is not proof of client identity. Allowed preflights advertise only `POST` with `Authorization` and `Content-Type`, and allowed actual responses repeat the exact request Origin. Unlisted Origins fail before the bearer credential or request body is processed.

`null` is shared by all opaque origins, including unrelated local files, `data:` documents, and sandboxed frames; it identifies neither Nexus nor a particular application package. Never allow it on a network-exposed deployment, including through a reverse proxy. This CORS policy covers only `/v1/invitations`; WebSocket connections continue to rely on their room-scoped token authentication and are not protected by HTTP CORS preflight.

## Connect the Engine

```ts
import { createCollaborationEngine } from "@floatboat/nexus-plugin-collab";
import { createHocuspocusProviderFactory } from "@floatboat/nexus-plugin-collab/hocuspocus";

const provider = createHocuspocusProviderFactory({
    url: "wss://collab.example.com",
    token: documentId => hostCredentials.shortLivedTokenFor(documentId),
});
const engine = createCollaborationEngine({
  providers: provider,
  store: browserReplicaStore,
});

// After the Host refreshes its credential, force a fresh handshake.
await provider.control.reconnect(documentId);
```

The token resolver runs again on every automatic or explicit reconnect; it should read the latest credential from trusted Host state rather than close over a fixed token. The adapter reports transport, initial synchronization, authentication, and access independently. Malformed, forged, or wrong-room credentials become `authentication="denied"`; elapsed credentials become `authentication="expired"`; actively revoked grants become `authentication="revoked"`. Their stable diagnostics are `authentication-denied`, `authentication-expired`, and `authorization-revoked`. All three remove access and local Presence until reauthentication, while an ordinary disconnect remains a transport failure. `read-only` and revoked access reject Local Proposals before they enter Yjs. Invitation callers must use `open(..., { readiness: "require-authenticated-sync" })`; this starts from remote authority and replaces any divergent durable join cache only after authenticated sync, so neither reader nor editor credentials can upload it. A valid durable local Replica may use `local-only` only for an explicitly enrolled resume; that state makes no server-authorization claim.

## Persistence and recovery

The reference server stores the exact binary Yjs state, not JSON or reconstructed Markdown. Each document name is SHA-256 keyed, so an opaque DocumentId is never interpreted as a filesystem path. Writes use a same-directory temporary file, file sync, atomic rename, and directory sync. A versioned header, DocumentId, lengths, and checksum make truncation, key mismatch, and corruption fail closed.

Revoked token IDs are persisted separately and survive restart until their expiry. Tokens and document plaintext are not written to logs by this app.

This single-node file store intentionally does not provide distributed locking, multi-node replication, cloud backup, or a database migration story. Replace the Hocuspocus persistence hooks with a Host-qualified database adapter before horizontal deployment; the Nexus Engine and Provider interfaces do not change.

## Security limits

- default WebSocket frame limit: 1 MiB
- default encoded state retained and persisted per Collaborative Document: 8 MiB, with a hard configurable ceiling of 16 MiB (`NEXUS_COLLAB_MAX_DOCUMENT_BYTES`)
- default authenticated pending budget per document connection: 8 messages and 2 MiB (`NEXUS_COLLAB_MAX_AUTHENTICATED_QUEUE_MESSAGES`, `NEXUS_COLLAB_MAX_AUTHENTICATED_QUEUE_BYTES`)
- the pre-authentication queue is independently capped at the stricter of its transport budget and the authenticated pending budget; during the handoff, admitted work is bounded by the sum of the bootstrap and established budgets (never more than twice the authenticated budget)
- pending unauthenticated documents per connection: 8
- server-persistence generation waiters are capped at 64 per document
- default per-client Awareness state: 16 KiB; at most 64 states per message
- Provider URL credentials are rejected; pass short-lived tokens through the token resolver
- invitation credentials are delegated only by a same-document editor, are sent only in the request body/response, and never expose the signing secret
- invitation CORS responses echo only a configured exact Origin; wildcard Origins and credentialed CORS are not enabled
- authenticated user identity overwrites client-supplied Presence identity at the server
- every writer update yields once under its room lock, then is checked against the complete candidate Yjs state before it is applied; exceeding the document limit rejects that update with the stable `document-size-limit` reason without taking down other rooms
- exceeding either authenticated pending budget closes the responsible document connection with `authenticated-queue-limit`; already admitted work stays bounded and unrelated rooms and health probes continue to make progress
- denied and expired handshakes remain distinguishable from transport failure in the client snapshot
- active revocation closes the document connection, clears Presence, and changes the client snapshot to `authentication="revoked", access="none"`
- runtime revocation and every authenticated inbound message share a credential-scoped operation turn through response/apply completion: admitted writer, Awareness, reader SyncStep1, and QueryAwareness work either finishes before `revokeToken()` returns or observes durable revocation without mutating or sending protected state afterward; writers alone additionally take a per-document turn, so read-only sync remains non-mutating and unrelated rooms stay isolated
- expired revocation records are pruned on store load and before every atomic write, so restart cannot retain or reactivate stale entries

Run the qualification tests with:

```bash
pnpm --filter @floatboat/nexus-collab-server test
pnpm --filter @floatboat/nexus-collab-server typecheck
pnpm --filter @floatboat/nexus-collab-server build
```
