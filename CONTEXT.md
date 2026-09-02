# Nexus Editor Domain

Nexus Editor is the reusable Markdown editing domain shared by framework bindings, editor plugins, and Host applications. These terms describe product meaning rather than a particular implementation.

## Documents and hosts

**Markdown Document**:
The user's durable Markdown text and its semantic structure.
_Avoid_: editor state, AST document, file buffer

**Editor**:
An interactive view of one Markdown Document. Several Editors may show the same document.
_Avoid_: document, file, room

**Host**:
The product embedding Nexus and owning files, identity, authorization, persistence policy, and product UI.
_Avoid_: editor, plugin runtime

**File Identity**:
A Host-scoped logical identity for a file that survives a supported rename. It does not by itself identify a cross-device Collaborative Document.
_Avoid_: path, DocumentId

## Collaboration

**Collaborative Document**:
A shareable document identified by one stable DocumentId and edited by converging Replicas. While collaboration is active, Editors and Markdown files are projections of it.
_Avoid_: room file, editor document, Y.Text

**DocumentId**:
An opaque identity that remains stable across file renames, Editors, windows, processes, and devices.
_Avoid_: path, FileId, room name, document key

**DocumentRef**:
A DocumentId paired with current Host context such as a display name, vault identity, or projection location.
_Avoid_: file path, document key

**Enrollment**:
The explicit Host action that creates or joins a Collaborative Document and associates it with a local Markdown Document.
_Avoid_: auto-sync, implicit room creation

**Replica**:
One process's locally usable copy of a Collaborative Document.
_Avoid_: backup, version history, Editor

**Participant**:
An authenticated principal currently authorized to interact with a Collaborative Document.
_Avoid_: cursor, Awareness client

**Presence**:
Short-lived participant information such as display identity, cursor, and selection. Presence is neither durable document data nor proof of authorization.
_Avoid_: member record, permission, document state

## Change and projection

**Local Proposal**:
A requested local edit that may still be accepted, rejected, or replaced by editor policy.
_Avoid_: committed update, remote update

**Authoritative Update**:
A committed change from the active document authority that every attached Editor must project without local semantic rewriting.
_Avoid_: proposal, file load

**File Projection**:
The Markdown file representation of a Collaborative Document at a Host-managed location.
_Avoid_: replica store, collaboration authority

**Projection Base**:
The last Markdown content and collaborative revision confirmed by both the Collaborative Document and its File Projection.
_Avoid_: latest file, autosave snapshot

**File Conflict**:
A state in which an external Markdown change cannot be safely reconciled with the live Collaborative Document from the known Projection Base.
_Avoid_: CRDT conflict, merge success

**Quarantine**:
A protective state that stops ordinary writes when the system can no longer prove that an Editor and its Collaborative Document agree.
_Avoid_: disconnected, read-only mode
