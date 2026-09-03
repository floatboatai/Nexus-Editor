## ADDED Requirements

### Requirement: A Host Workspace owns the collaboration product lifecycle

The Host MUST provide one Collaboration Workspace module that owns enrollment, create, join, attach, leave, reconnect, projection, and cleanup orchestration while delegating CRDT behavior to `CollaborationEngine`. It MUST NOT introduce a second Replica or synchronization state machine. Operations MUST be idempotent and expose stable pending, ready, read-only, offline, conflict, failed, and closed states.

#### Scenario: User creates collaboration for the current file

- **WHEN** an authenticated user enables collaboration for an unenrolled Markdown file
- **THEN** the Workspace MUST allocate and persist a stable DocumentId, create the Collaborative Document exactly once, attach the current Editor, and start File Projection
- **AND** the user MUST see whether network, authorization, local persistence, server persistence, and file projection are ready

#### Scenario: User joins an existing document

- **WHEN** a user supplies a valid invitation for an existing DocumentId
- **THEN** the Workspace MUST authorize and synchronize before replacing or attaching the current Editor
- **AND** identity or content mismatches MUST require an explicit choice rather than silent replacement

#### Scenario: Competing windows join one local path

- **WHEN** two renderer sessions attempt invitation join for the same Vault path with different FileId or DocumentId
- **THEN** one Host-owned path opening MUST cover authenticated join, File Projection, and durable Enrollment commit
- **AND** the other join and every unrelated overlapping Host mutation MUST fail before filesystem write
- **AND** before any Projection metadata or filesystem write, the Host MUST install an exact precommit, persist a non-secret pending join bound to VaultId, original sender/session, operationId, path, FileId, and DocumentId, and promote the opening to committed
- **AND** Enrollment plus pending phase `enrollment-committed` MUST commit atomically, then release the exact Host opening before clearing the pending join or reporting an active Workspace
- **AND** renderer-process failure MUST make its opening inactive but retain the enumerable blocking fence and immutable original owner for exact recovery
- **AND** after Host restart the durable pending join MUST recreate the fence before overlapping mutation is enabled

#### Scenario: Interrupted invitation join is recovered from durable evidence

- **GIVEN** an exact pending join remains after renderer termination, Host restart, or Host-release failure
- **WHEN** recovery finds the exact committed Enrollment
- **THEN** it MUST finish Host release and clear only that matching pending join
- **WHEN** recovery instead finds exact Projection metadata, including an identity whose Projection Base is null
- **THEN** it MUST commit the exact Enrollment and finish release without rewriting or deleting the Markdown file
- **WHEN** no Projection metadata exists
- **THEN** it MUST retain the pending join and Host fence because absence does not prove that a file write never occurred
- **AND** the same invitation MAY retry the retained exact operation
- **AND** a locally owned active fence MUST enter this evidence check, while another live renderer's fence MUST remain untouched

#### Scenario: Explicit pending-join abandon is evidence constrained

- **GIVEN** an opening-phase pending join has no Projection metadata
- **WHEN** the user explicitly confirms abandon
- **THEN** the Host MAY release only that exact coordination fence and pending join and MUST NOT modify the Markdown file
- **AND** if durable pending-join removal fails after Host release, the Host MUST restore and commit the exact fence before returning failure; an ambiguous removal MAY finish only when read-back proves the pending join is absent
- **GIVEN** any Projection metadata exists for the pending join FileId
- **WHEN** abandon is requested
- **THEN** it MUST fail closed and retain both pending join and fence until exact Enrollment recovery completes

#### Scenario: Pending cleanup fails after Enrollment commit and Host release

- **GIVEN** Enrollment and pending phase `enrollment-committed` were committed in one durable mutation
- **WHEN** exact Host release succeeds but clearing that committed pending join fails
- **THEN** the active Enrollment and committed pending join MUST continue to block a competing join, rename, forget, or delete
- **AND** later recovery MUST rebind the exact operation only to finish pending cleanup, without rewriting the Markdown file

#### Scenario: Cached local state cannot authorize a join

- **GIVEN** a durable Replica already exists for the invitation's ServerUrl and DocumentId
- **WHEN** the invitation credential is denied, expired, wrong-document, or revoked
- **THEN** the Workspace MUST fail before creating File Projection or durable Enrollment state
- **AND** the Workspace MUST NOT expose an active session or attach the Editor

#### Scenario: Invitation is bound to its configured server

- **GIVEN** the invitation adapter is configured for one canonical ServerUrl
- **WHEN** an otherwise valid invitation names a different canonical ServerUrl
- **THEN** acceptance MUST fail before writing its credential or accepted-server state
- **AND** the Workspace MUST NOT create File Projection, Enrollment, or an active session

#### Scenario: Concurrent credential refresh is serialized per document

- **GIVEN** a Collaborative Document has suspended its Editor Bindings for reauthentication
- **WHEN** two credential refresh commands overlap for that DocumentId
- **THEN** the Host MUST run at most one Provider reconnect and at most one Binding-resume flow for the attempted credential generation
- **AND** a credential staged during that operation MUST remain pending for an explicit later retry
- **AND** failure rollback MUST NOT replace a newer active credential
- **AND** refreshes for different DocumentIds MUST remain independent

#### Scenario: Leave starts during credential refresh

- **WHEN** leave or Workspace close starts while reauthentication is waiting for the Provider
- **THEN** teardown MUST wait for or cancel that refresh before releasing the session and backend
- **AND** a late authentication grant MUST NOT attach or revive an Editor Binding after the session starts closing

#### Scenario: Save is serialized with document context changes

- **WHEN** an ordinary or collaboration projection Save overlaps open, Save As, rename, delete, create, join, resume, or pending recovery
- **THEN** the Host MUST serialize both operations through the same document-context transaction
- **AND** the Save MUST capture the exact path, Markdown, and generation it writes
- **AND** a late Save MUST NOT clear dirty state for newer Editor content or a different file identity

#### Scenario: File delete is fenced across windows

- **WHEN** the user approves deletion of a file or directory after the document-context gate
- **THEN** the Host MUST atomically reserve that path and every descendant before filesystem trash starts
- **AND** begin-create, commit, upsert, and rename MUST reject identities covered by the reservation
- **AND** one same-Vault Host mutation barrier MUST let already admitted projection writes finish before reservation succeeds, then reject every later write, folder creation, or rename that overlaps the reserved path across all renderer senders and Vault sessions
- **AND** only trash carrying the reservation's exact operation identity MAY cross that Host fence
- **AND** post-delete coordination MUST forget every exact descendant Enrollment and Projection Base before releasing the reservation
- **AND** trash failure MAY release the reservation, while coordination failure after successful trash MUST retain it for explicit recovery
- **AND** renderer or Vault-session close MUST NOT release the reservation; a new product instance MUST reinstall every durable reservation in the Host before enabling file mutations
- **AND** the Host fence MUST be installed as an enumerable precommit before durable reservation CAS and promoted only after exact durable read-back

#### Scenario: Incomplete cleanup requires an explicit recovery action

- **GIVEN** another renderer may still own a durable identity tombstone or delete reservation
- **WHEN** a new Collaboration panel opens
- **THEN** the Host MUST enumerate the incomplete operation without automatically restoring, completing, expiring, or releasing it
- **AND** the user MAY explicitly finish cleanup for a missing path or restore exact tombstones and abort cleanup for a path that still exists
- **AND** a successful explicit recovery from any same-Vault session MUST release both the durable reservation and its exact Host fence

### Requirement: Product UI exposes actionable collaboration state

The Electron reference Host MUST provide create/join/leave controls, server and invitation configuration, participant display, access mode, reconnect state, unsaved-local warning, and File Conflict recovery actions. Secret credentials MUST stay in the privileged Host or in-memory capability and MUST NOT be printed, persisted in Markdown, embedded in URLs, or exposed to untrusted plugin code.

#### Scenario: Connection or persistence fails

- **WHEN** authentication, network, local Store, server persistence, or File Projection fails
- **THEN** the UI MUST identify the failed dimension and an available retry, leave, or recovery action
- **AND** MUST NOT collapse the state into a generic connected/disconnected badge

#### Scenario: Interrupted join is visible and actionable

- **WHEN** an incomplete pending join remains
- **THEN** the panel MUST show its path, DocumentId, and recovery outcome
- **AND** MUST explain that safe recovery and abandon do not rewrite or delete the Markdown file
- **AND** MUST offer safe recovery plus same-invitation retry
- **AND** MUST offer explicit abandon only when no Projection metadata exists

### Requirement: Independent windows use the production path

The primary Electron collaboration acceptance path MUST use distinct renderer processes and the real Provider and durable Store. The assessment two-editor lab MAY remain as a deterministic developer tool, but MUST NOT be the product entry or the evidence for multi-window qualification.

#### Scenario: Reference Host starts on the product path

- **WHEN** the Electron reference Host starts without an explicit compatibility override
- **THEN** its initial window MUST use the runtime Host with the real plugin and collaboration bridges
- **AND** `NEXUS_PLUGIN_PLATFORM=0` MAY select the explicit legacy compatibility Host without weakening sandboxed-preload isolation

#### Scenario: Two windows collaborate and recover

- **WHEN** two application windows join the same document, one goes offline or closes, and later returns
- **THEN** they MUST converge through the real Provider while preserving independent Presence and local history
- **AND** the returning window MUST restore its durable local Replica before reconnecting

### Requirement: The Host configures trusted collaboration servers before renderer networking

The Electron Host MUST accept an explicit bounded allowlist of canonical collaboration ServerUrls, defaulting to the local reference server. Plaintext WebSocket MUST remain loopback-only. The same configuration MUST constrain renderer create/join/resume, the Content Security Policy, and main-process invitation requests. Untrusted or malformed configuration MUST fail closed without exposing credentials. Neither disabled web security, wildcard connection permissions, nor bypassed certificate validation MAY be used as a connectivity fix.

#### Scenario: A configured server is usable in development and built applications

- **WHEN** the Host starts with an allowed loopback WS or remote WSS server
- **THEN** its renderer MUST be able to connect under an enforced CSP before running collaboration code
- **AND** a built application MUST serve only its own static assets through a confined secure application origin
- **AND** developer-server loading MUST remain limited to validated loopback HTTP origins

#### Scenario: An invitation names an untrusted server

- **WHEN** create, join, or resume names a canonical ServerUrl outside the Host allowlist
- **THEN** the Host MUST reject it before constructing a Provider, installing a credential, or writing Enrollment or File Projection
- **AND** the UI MUST explain how to configure a trusted server without printing the credential

### Requirement: Desktop invitation requests use a restricted Host command

The Electron renderer MUST request delegated invitations through a purpose-specific main-process command rather than directly fetching from an opaque application origin. The main process MUST validate the top-level registered sender, exact allowed server, token and identity bounds, fixed invitation route, request lifetime, and returned document/user/role. It MUST bound concurrency, body size, response size, and duration, reject redirects, and cancel pending work when the sender disappears. It MUST NOT expose arbitrary fetch, cookies, signing secrets, raw network failures, or private document content through this command.

#### Scenario: Desktop creates an invitation against an HTTPS server

- **WHEN** a registered runtime window with an editor credential requests an invitation for an allowed WSS server
- **THEN** the main process MUST issue a credential-header POST to that server's HTTPS `/v1/invitations` endpoint with normal certificate verification
- **AND** it MUST send neither browser cookies nor an opaque `null` Origin
- **AND** the renderer MUST receive only a validated delegated envelope or a stable non-secret failure

#### Scenario: Untrusted senders and redirects cannot reuse credentials

- **WHEN** a subframe, unregistered window, untrusted server, oversized payload, or redirect attempts to cross the invitation command
- **THEN** the Host MUST reject it without forwarding credentials to a different endpoint

#### Scenario: Automated acceptance exercises actual renderer networking

- **WHEN** the local handoff verification runs
- **THEN** distinct real Electron windows MUST execute create, invite, join, edit, local history, read-only enforcement, restart recovery, and conflict recovery using the real Provider and Store
- **AND** a TLS fixture MUST retain certificate verification and distinguish local trusted-certificate evidence from an untested public deployment
