# Single-node self-hosted deployment

This runbook installs one reference server on a dedicated Linux host. It does not execute infrastructure changes, provision a domain/certificate, or claim a production-supported Host. Keep the service single-instance: the file store has no cross-process lock or replication. Never start a second server against the same data directory, including during a rolling update.

The intended route is `Electron → wss://collab.example.com:443 → Nginx → 127.0.0.1:1234`. The public HTTP invitation endpoint uses the same TLS hostname. Only 443 is opened to clients; 1234 remains loopback-only. Protect SSH/administration separately. If a load balancer replaces Nginx, preserve the same TLS, WebSocket, logging, Origin, and single-writer boundaries.

## 1. Prepare an immutable release and service identity

Requirements: Node.js 22+ at `/usr/bin/node`, pnpm 9.15.4 for the build, Linux with systemd 247+ (`LoadCredential`), Nginx with TLS/WebSocket support, a DNS name, and a trusted certificate. Confirm actual executable paths with `command -v node` and adjust the unit when your supported Node installation lives elsewhere. Do not depend on an interactive shell's version manager.

Install the reviewed release workspace at `/opt/nexus-editor` using your deployment account. From that release root, build before exposing it:

```bash
pnpm install --frozen-lockfile
pnpm --filter @floatboat/nexus-core build
pnpm --filter @floatboat/nexus-plugin-collab build
pnpm --filter @floatboat/nexus-collab-server build
node --test apps/collab-server/deploy/run-with-credentials.test.mjs
```

Retain the built workspace and its installed runtime dependencies, including pnpm's `node_modules/.pnpm` and workspace symlink targets. Copying only `dist/cli.js` will not work: it imports sibling chunks and external packages. Do not build/install packages as the service account or make the release writable by that account. Use a reviewed artifact without personal vaults, repository credentials, local `.env` files, or previous collaboration data; build artifacts belong in deployment artifacts, not Git.

On a new dedicated host, create the identity and private configuration directory (adapt the `nologin` path to the distribution):

```bash
sudo useradd --system --user-group --home-dir /var/lib/nexus-collab --shell /usr/sbin/nologin nexus-collab
sudo install -d -o root -g root -m 0700 /etc/nexus-collab
sudo install -o root -g root -m 0600 /opt/nexus-editor/apps/collab-server/deploy/server.env.example /etc/nexus-collab/server.env
```

If the account/directory already exists, inspect ownership and contents first; do not recreate or overwrite a working deployment. Ensure the service account can traverse/read `/opt/nexus-editor` and its dependencies but cannot modify them. The unit creates `/var/lib/nexus-collab` owned by `nexus-collab`, mode 0700. Its filesystem sandbox keeps the release read-only and permits writes to that state directory and private temporary storage.

## 2. Generate one persistent signing credential

Generate a random key without printing it or placing it in shell history. This command creates a new file with exclusive-create semantics; it fails instead of overwriting an existing key:

```bash
sudo /usr/bin/node --input-type=module -e 'import { randomBytes } from "node:crypto"; import { writeFileSync } from "node:fs"; writeFileSync("/etc/nexus-collab/auth-secret", randomBytes(32).toString("base64url"), { mode: 0o600, flag: "wx" });'
```

Store a protected copy in the deployment's secret manager and reuse this exact key across restarts and trusted token issuance. Do not regenerate it in `ExecStart`, put it in the unit, copy it to a renderer, or add it to version control. Key replacement invalidates all outstanding tokens; coordinated refresh is required because this reference implementation does not support overlapping signing keys or `kid` rotation.

The service uses systemd `LoadCredential` to provide the protected file to `run-with-credentials.mjs`. The runner reads it and populates the existing CLI's process environment in the same Node process; it never places the secret in child arguments or logs. This is not a protection against root or a compromised service process. Restrict service-user access, core dumps, debugger access, and secret-manager permissions. systemd documents credential loading and private state directories in its [execution settings](https://github.com/systemd/systemd/blob/main/man/systemd.exec.xml).

The CLI does not auto-load `.env`. The unit explicitly loads only the non-secret `/etc/nexus-collab/server.env`. Confirm it contains:

```dotenv
NEXUS_COLLAB_STORAGE_DIR=/var/lib/nexus-collab
NEXUS_COLLAB_ADDRESS=127.0.0.1
NEXUS_COLLAB_PORT=1234
NEXUS_COLLAB_INVITATION_ORIGINS=
```

The last line must be present, not omitted: a loopback backend defaults to allowing opaque `null` when the variable is absent, even when reachable publicly through a proxy. Electron Main's invitation broker sends no Origin; an empty list therefore needs no public `null` exception. A browser-only Host may list its exact HTTPS origins instead. Never strip client Origin in the proxy: that would bypass the browser-origin rejection. No-Origin requests still require valid editor credentials.

## 3. Install and start the single service

```bash
sudo install -o root -g root -m 0644 /opt/nexus-editor/apps/collab-server/deploy/nexus-collab.service /etc/systemd/system/nexus-collab.service
sudo systemd-analyze verify /etc/systemd/system/nexus-collab.service
sudo systemctl daemon-reload
sudo systemctl enable --now nexus-collab.service
sudo systemctl status nexus-collab.service
curl --fail http://127.0.0.1:1234/healthz
```

`Type=exec` confirms process execution, not application readiness. `/healthz` and `/readyz` currently both return `{"status":"ok"}` while serving; they do not certify storage health or successful authorization. Add an authenticated canary edit/reopen check plus disk space/inode and service-failure monitoring before relying on this host. Do not present a 200 probe as durable-state proof.

`systemctl stop nexus-collab` sends SIGTERM to the same CLI process. The server closes connections and attempts bounded persistence shutdown (currently five seconds); the unit allows 15 seconds before systemd's final kill. Inspect the unit's exit result and journal. A failed shutdown, timeout, forced kill, or storage error is not a clean durable stop. After correcting the cause, validate recovery before continuing. The service restarts on unexpected failure, but an explicit stop stays stopped; systemd's [service lifecycle documentation](https://github.com/systemd/systemd/blob/main/man/systemd.service.xml) defines these behaviors.

## 4. Terminate TLS and proxy WebSockets

Provision and test your certificate/renewal separately; the template does not obtain certificates. Edit `nginx.conf.example` to replace `collab.example.com` and both certificate paths, then install it into a file included **inside Nginx's `http {}` block**, for example `/etc/nginx/conf.d/nexus-collab.conf`. Do not put its `map` or `log_format` directives inside another `server` block. Enable only one copy.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

The template explicitly forwards Upgrade/Connection and uses HTTP/1.1 for compatibility with older Nginx versions. The 75-second read timeout is an inactivity timeout, not a session lifetime; verify protocol keepalives on your actual path. See [Nginx WebSocket proxying](https://nginx.org/en/docs/http/websocket.html).

Only local requests may reach the two probe locations; add an exact private monitoring address only after reviewing the network boundary. Do not expose unauthenticated probes as an administration API. Nginx's [allow/deny rules](https://nginx.org/en/docs/http/ngx_http_access_module.html) are evaluated against its client connection; another upstream proxy requires a separately reviewed trusted real-IP configuration.

The access log includes only timestamp, status, duration, and byte count. It excludes request URI, query, headers, bodies, user identifiers, and credentials. Per-virtual-host native error logging is suppressed because Nginx may include raw request lines; use the safe access log and service diagnostics, and treat this reduced request-error visibility as an operational tradeoff. Audit global/default-vhost, CDN, WAF, APM, and load-balancer logging too, including failures before this virtual host is selected. Never enable request-body or WebSocket-frame capture on real documents. Never log invitation responses or put tokens in URLs. See [Nginx access-log configuration](https://nginx.org/en/docs/http/ngx_http_log_module.html).

This template does not define a universal request/connection rate or memory limit. Select and test per-IP/user/document admission limits for your workload; the server's existing per-message and per-document bounds are not global DDoS or tenant quota protection.

## 5. Issue a credential and connect the client

On the trusted server only, use a transient token-issuer unit with the same protected credential/configuration. The command below requires a systemd version supporting `systemd-run --pipe`; it prints a bearer token to this terminal, so disable terminal recording and never paste its output into logs or tickets:

```bash
sudo systemd-run --quiet --wait --pipe --collect \
  --property=User=nexus-collab \
  --property=Group=nexus-collab \
  --property=WorkingDirectory=/opt/nexus-editor \
  --property=EnvironmentFile=/etc/nexus-collab/server.env \
  --property=LoadCredential=auth-secret:/etc/nexus-collab/auth-secret \
  /usr/bin/node /opt/nexus-editor/apps/collab-server/deploy/run-with-credentials.mjs issue-token \
  --document local-collab-001 --user alice --role editor --ttl 3600
```

This CLI operation signs a token without starting a second server or writing snapshots. The document must match the panel's exact Document ID. Transfer only the short-lived `token` field via an approved secret channel. A real Host should replace manual issuance with its authenticated account/session service; the public invitation endpoint is delegation, not login.

Start each client with its trusted server configured:

```bash
NEXUS_COLLAB_SERVERS="wss://collab.example.com" pnpm dev:electron-demo
```

The client allowlist is separate from server bind settings and CORS. In the panel use `wss://collab.example.com`, open a Markdown file in a runtime Vault, and create collaboration with the matching document credential. The privileged Main broker calls `https://collab.example.com/v1/invitations`; no public `null` Origin exception is required. Use an invitation to join from a second independent client/Vault. The client must trust the TLS certificate; do not disable certificate validation to make a test pass.

Acceptance checks before handing the server to users:

- Confirm 1234 is bound only to loopback and blocked externally; HTTPS invitation requests with `Origin: null` return 403, and no-Origin requests without a token remain denied.
- In two actual client windows on separate machines, create → invite → join → edit concurrently and verify converged Markdown and both local file projections.
- Restart one client after an offline edit; restart the server without regenerating the key; reconnect and verify recovery, authorization, no duplicate edits, and persisted snapshots.
- Exercise reader denial, expired credentials, conflict/recovery UI, and a controlled service stop. Keep evidence sanitized and distinguish local automated checks from a real TLS/cross-machine run.

## 6. Backup, restore, and release replacement

The entire `/var/lib/nexus-collab` tree is sensitive document data even though snapshots are binary. It includes revocation records as well as snapshots; backing up only document files is incomplete. Keep the signing credential separately encrypted/permission-restricted and record the exact release revision, Node version, and non-secret configuration with each backup.

For this single-node reference store, use a maintenance window: stop ingress, ask clients to save/reach clean persistence, stop the service, verify a clean exit and absence of another writer, then copy/archive the full data directory into a private backup location. Encrypt off-host copies, define retention/RPO/RTO, and rehearse recovery. A live file copy is not a qualified consistent backup, and a successful stop cannot prove that a disconnected client's unsent edits reached the server.

Restore into a new private staging directory, not over the running database. Inspect archive paths, checksums, ownership, and modes; use the matching release/configuration and intended signing key. Keep the stopped original directory recoverable, then swap the reviewed restored tree into `/var/lib/nexus-collab`, owned only by the service account. Start one instance and test authenticated document reopen, edits, revocation, and restart before restoring ingress. If uncertain, stop and retain both copies instead of deleting evidence.

Restoring an older revocation list can reactivate an otherwise unexpired token. Preserve/reconcile newer revocations or deliberately rotate the signing key and reissue all credentials after restoration; do not silently assume a data backup is also current authorization state. Restoring old document snapshots can lose acknowledged edits, and connected replicas may replay newer state: coordinate client reconnection and account for this during the drill.

For upgrades, stage/build/test the new release separately, stop the single service cleanly, take a recoverable backup, replace the read-only release at `/opt/nexus-editor`, and start/validate before reopening ingress. Keep the same data directory and key. Do not overlap old and new writers. A code rollback does not imply data-format compatibility; preserve the original data and test the old release against a separate backup before any rollback.

## Qualification boundary

The checked-in runner tests use a temporary credential, loopback HTTP, and the built CLI; unit syntax validation does not install the service. Real certificate issuance/renewal, Nginx execution, remote networking, multi-machine Electron workflows, disk-failure injection, backup/restore drills, identity-service integration, rate-limit tuning, monitoring, and long-running load tests require evidence on the deployment host. Until those gates pass, describe this as a self-hosted single-node reference deployment, not a production-supported cloud service.
