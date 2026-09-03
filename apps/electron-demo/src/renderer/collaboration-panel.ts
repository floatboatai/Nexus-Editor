import {
  asDocumentId,
  type CollaborationWorkflowSnapshot,
  type FileProjectionConflict,
} from "@floatboat/nexus-plugin-collab";

import type {
  CollaborationEnrollmentRecord,
  CollaborationIdentityDeletion,
  CollaborationPathDeletionReservation,
  CollaborationPendingCreationRecord,
  CollaborationPendingJoin,
} from "./collaboration-enrollment-store";
import type {
  CollaborationWorkspace,
  CollaborationWorkspaceFile,
  CollaborationWorkspaceSnapshot,
} from "./collaboration-workspace";

export interface CollaborationPanelOptions {
  readonly ownerDocument?: Document;
  readonly workspace: CollaborationWorkspace;
  readonly serverUrls?: readonly string[];
  readonly getCurrentFile: () => CollaborationWorkspaceFile | null;
  readonly isCurrentFileDirty: () => boolean;
  readonly createDocumentId?: () => ReturnType<typeof asDocumentId>;
  readonly runOpening?: (
    file: CollaborationWorkspaceFile,
    operation: (
      currentFile: CollaborationWorkspaceFile,
      assertContextCurrent: () => void,
    ) => Promise<void>,
  ) => Promise<void>;
  readonly openDeveloperLab?: () => void | Promise<void>;
  readonly fileDeletionRecovery?: {
    list(): Promise<readonly {
      readonly reservation: CollaborationPathDeletionReservation;
      readonly pathState: "present" | "missing";
    }[]>;
    recover(operationId: string, resolution: "abort" | "complete"): Promise<void>;
  };
  readonly enrollmentMutationRecovery?: {
    list(): Promise<readonly {
      readonly deletion: CollaborationIdentityDeletion;
      readonly projectionState: "present" | "missing";
    }[]>;
    finish(deletion: CollaborationIdentityDeletion): Promise<void>;
  };
  readonly pendingJoinRecovery?: {
    list(): Promise<readonly CollaborationPendingJoinRecovery[]>;
    recover(): Promise<unknown>;
    abandon(operationId: string): Promise<void>;
  };
}

export interface CollaborationPendingJoinRecovery {
  readonly pending: CollaborationPendingJoin;
  readonly outcome:
    | "completed-enrollment"
    | "pending-active-renderer"
    | "pending-evidence"
    | "blocked-conflict"
    | "released-host-precommit"
    | "blocked-host-commit";
  readonly message: string;
  readonly hasProjectionMetadata: boolean;
  readonly canAbandon: boolean;
}

export interface CollaborationPanel {
  readonly element: HTMLElement;
  open(): Promise<void>;
  refreshFile(): Promise<void>;
  hide(): void;
  destroy(): void;
}

interface PanelDrafts {
  createServerUrl: string;
  createDocumentPath: string | null;
  createDocumentId: string;
  createUserId: string;
  createDisplayName: string;
  resumeUserId: string;
  resumeDisplayName: string;
  pendingUserId: string;
  pendingDisplayName: string;
  manualMerge: string;
  issuedInvitation: string;
}

function defaultDocumentId(): ReturnType<typeof asDocumentId> {
  const value = globalThis.crypto?.randomUUID?.();
  if (!value) throw new Error("A cryptographically random UUID source is required");
  return asDocumentId(value);
}

function appendText(parent: HTMLElement, tag: keyof HTMLElementTagNameMap, text: string, className?: string) {
  const element = parent.ownerDocument.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function button(
  document: Document,
  label: string,
  action: () => void | Promise<void>,
  options: {
    className?: string;
    disabled?: boolean;
    data?: readonly [string, string];
    onError?: (cause: unknown) => void;
  } = {},
): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  if (options.className) element.className = options.className;
  element.disabled = options.disabled === true;
  if (options.data) element.dataset[options.data[0]] = options.data[1];
  const report = (cause: unknown): void => {
    try { options.onError?.(cause); } catch { /* A UI reporting failure must not escape the event loop. */ }
  };
  element.addEventListener("click", () => {
    try {
      void Promise.resolve(action()).catch(report);
    } catch (cause) {
      report(cause);
    }
  });
  return element;
}

function field(
  document: Document,
  form: HTMLFormElement,
  options: {
    label: string;
    name: string;
    value?: string;
    type?: HTMLInputElement["type"];
    placeholder?: string;
    maxLength?: number;
    autocomplete?: string;
  },
): HTMLInputElement {
  const label = document.createElement("label");
  label.className = "nexus-collaboration__field";
  const text = document.createElement("span");
  text.textContent = options.label;
  const input = document.createElement("input");
  input.name = options.name;
  input.type = options.type ?? "text";
  input.value = options.value ?? "";
  input.required = true;
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.maxLength) input.maxLength = options.maxLength;
  if (options.autocomplete) input.setAttribute("autocomplete", options.autocomplete);
  label.append(text, input);
  form.append(label);
  return input;
}

function textArea(
  document: Document,
  form: HTMLFormElement,
  options: { label: string; name: string; value?: string; maxLength?: number; rows?: number },
): HTMLTextAreaElement {
  const label = document.createElement("label");
  label.className = "nexus-collaboration__field";
  const text = document.createElement("span");
  text.textContent = options.label;
  const input = document.createElement("textarea");
  input.name = options.name;
  input.value = options.value ?? "";
  input.required = true;
  input.rows = options.rows ?? 5;
  if (options.maxLength) input.maxLength = options.maxLength;
  label.append(text, input);
  form.append(label);
  return input;
}

function stringValue(form: HTMLFormElement, name: string): string {
  const control = form.elements.namedItem(name);
  return control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement
    ? control.value.trim()
    : "";
}

function nonSecretError(cause: unknown): string {
  const code = cause && typeof cause === "object" ? Reflect.get(cause, "code") : undefined;
  const messages: Record<string, string> = {
    "content-mismatch": "The current Editor differs from the shared document.",
    "editor-content-mismatch": "The current Editor differs from the shared document.",
    "unsafe-leave": "The Markdown projection is unresolved. Resolve it or use the explicit discard action.",
    "authentication-failed": "The credential was rejected or expired.",
    "authentication-denied": "The collaboration server rejected this credential.",
    "authentication-expired": "This collaboration credential expired. Supply a fresh credential.",
    "authorization-revoked": "Access was revoked. Supply a fresh credential.",
    "remote-authority-unavailable": "This window already opened a local Replica. Close it before joining from an invitation.",
    "delegation-not-authorized": "This credential cannot create invitations. Reauthenticate with an editor credential.",
    "delegation-outlives-authority": "This credential expires too soon for a new invitation. Reauthenticate and try again.",
    "invitation-invalid": "The invitation is invalid, expired, or for another server.",
    "invitation-request-failed": "The collaboration server could not create an invitation. Check the connection and try again.",
    "invitation-server-mismatch": "This invitation belongs to a different collaboration server. Check the invitation server and try again.",
    "network-request-failed": "The collaboration server could not complete the request.",
    "store-connection-timeout": "Local collaboration persistence is unavailable.",
    "enrollment-write-failed": "The remote document may exist, but its local enrollment could not be saved. Use the recovery action below.",
    "enrollment-read-failed": "Local collaboration enrollment storage could not be read. Check local storage and try again.",
    "pending-creation-credential-required": "Enter the owner credential to recover this pending creation.",
    "document-context-changed": "The active file changed before collaboration could open. Start again from the current file.",
    "file-delete-recovery-state-changed": "The file changed while deletion recovery was open. Refresh and choose the matching action.",
    "enrollment-delete-reserved": "An incomplete file deletion is blocking collaboration changes on this path.",
    "pending-join-projection-present": "Projection metadata exists for this join. Recover it first, then forget the completed enrollment if needed.",
    "projection-opening-conflict": "This pending join is still protected by another window or by mismatched recovery evidence.",
    "projection-opening-release-failed": "The Host safety fence could not be released. Recovery remains available and file changes stay blocked.",
  };
  return typeof code === "string" && messages[code]
    ? messages[code]
    : "The collaboration action failed. Review the status details and try again.";
}

function statusValue(value: string): string {
  return value.replaceAll("-", " ");
}

function manualTemplate(conflict: FileProjectionConflict): string {
  return [
    "<<<<<<< SHARED",
    conflict.live.markdown,
    "=======",
    conflict.incoming.markdown,
    ">>>>>>> DISK",
  ].join("\n");
}

export function createCollaborationPanel(options: CollaborationPanelOptions): CollaborationPanel {
  const ownerDocument = options.ownerDocument ?? document;
  const createDocumentId = options.createDocumentId ?? defaultDocumentId;
  const runOpening = options.runOpening ?? ((capturedFile, operation) => {
    const currentFile = options.getCurrentFile();
    if (!currentFile || currentFile.path !== capturedFile.path || currentFile.editor !== capturedFile.editor) {
      return Promise.reject(Object.assign(new Error("The active document changed"), {
        code: "document-context-changed",
      }));
    }
    const assertContextCurrent = (): void => {
      const current = options.getCurrentFile();
      if (
        !current
        || current.path !== currentFile.path
        || current.editor !== currentFile.editor
        || current.markdown !== currentFile.markdown
      ) {
        throw Object.assign(new Error("The active document changed"), {
          code: "document-context-changed",
        });
      }
    };
    return operation(currentFile, assertContextCurrent);
  });
  const overlay = ownerDocument.createElement("div");
  overlay.className = "nexus-collaboration";
  overlay.hidden = true;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "nexus-collaboration-title");

  const dialog = ownerDocument.createElement("section");
  dialog.className = "nexus-collaboration__dialog";
  const header = ownerDocument.createElement("header");
  const heading = ownerDocument.createElement("div");
  const title = appendText(heading, "h2", "Collaboration");
  title.id = "nexus-collaboration-title";
  appendText(
    heading,
    "p",
    "Authenticated realtime editing with durable local recovery and an explicit Markdown file projection.",
  );
  const closeButton = button(ownerDocument, "Close panel", () => panel.hide());
  closeButton.setAttribute("aria-label", "Close collaboration panel");
  header.append(heading, closeButton);
  const body = ownerDocument.createElement("div");
  body.className = "nexus-collaboration__body";
  dialog.append(header, body);
  overlay.append(dialog);

  let destroyed = false;
  let busy = false;
  let uiError: string | null = null;
  let enrollment: CollaborationEnrollmentRecord | null = null;
  let enrollmentPath: string | null | undefined;
  let pendingCreation: CollaborationPendingCreationRecord | null = null;
  let pendingCreationPath: string | null | undefined;
  let lastConflictId: string | null = null;
  let fileDeletionRecoveries: readonly {
    readonly reservation: CollaborationPathDeletionReservation;
    readonly pathState: "present" | "missing";
  }[] = [];
  let enrollmentMutationRecoveries: readonly {
    readonly deletion: CollaborationIdentityDeletion;
    readonly projectionState: "present" | "missing";
  }[] = [];
  let pendingJoinRecoveries: readonly CollaborationPendingJoinRecovery[] = [];
  const drafts: PanelDrafts = {
    createServerUrl: options.serverUrls?.[0] ?? "ws://127.0.0.1:1234",
    createDocumentPath: null,
    createDocumentId: "",
    createUserId: "",
    createDisplayName: "",
    resumeUserId: "",
    resumeDisplayName: "",
    pendingUserId: "",
    pendingDisplayName: "",
    manualMerge: "",
    issuedInvitation: "",
  };

  const ensureCreateDocumentId = (file: CollaborationWorkspaceFile): void => {
    if (drafts.createDocumentPath === file.path) return;
    drafts.createDocumentPath = file.path;
    drafts.createDocumentId = createDocumentId();
  };

  const run = async (operation: () => Promise<void>, clearSensitive?: () => void): Promise<void> => {
    if (busy || destroyed) return;
    busy = true;
    uiError = null;
    clearSensitive?.();
    render();
    try {
      await operation();
    } catch (cause) {
      uiError = nonSecretError(cause);
    } finally {
      busy = false;
      try {
        await refreshEnrollment();
      } catch (cause) {
        if (!uiError) uiError = nonSecretError(cause);
      }
      render();
    }
  };

  const refreshEnrollment = async (): Promise<void> => {
    [fileDeletionRecoveries, enrollmentMutationRecoveries, pendingJoinRecoveries] = await Promise.all([
      options.fileDeletionRecovery?.list() ?? [],
      options.enrollmentMutationRecovery?.list() ?? [],
      options.pendingJoinRecovery?.list() ?? [],
    ]);
    const file = options.getCurrentFile();
    const path = file?.path ?? null;
    if (enrollmentPath !== path) {
      enrollment = null;
      enrollmentPath = undefined;
    }
    if (pendingCreationPath !== path) {
      pendingCreation = null;
      pendingCreationPath = undefined;
    }
    const [nextEnrollment, nextPendingCreation] = file
      ? await Promise.all([
          options.workspace.findEnrollment(file.path),
          options.workspace.findPendingCreation(file.path),
        ])
      : [null, null];
    if ((options.getCurrentFile()?.path ?? null) !== path) return;
    const retainedPending = options.workspace.getState().pendingCreation;
    enrollment = nextEnrollment;
    enrollmentPath = path;
    pendingCreation = nextPendingCreation ?? (
      retainedPending?.path === path && options.workspace.canRetryPendingCreationWithoutCredential(path ?? "")
        ? retainedPending
        : null
    );
    pendingCreationPath = path;
  };

  const renderFileDeletionRecoveries = (): void => {
    if (fileDeletionRecoveries.length === 0) return;
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card nexus-collaboration__card--warning";
    appendText(card, "h3", "Incomplete file deletion");
    appendText(
      card,
      "p",
      "A previous window stopped during a protected delete. This window will not release its cross-window reservation automatically.",
    );
    for (const recovery of fileDeletionRecoveries) {
      const row = ownerDocument.createElement("div");
      row.className = "nexus-collaboration__danger-zone";
      appendText(
        row,
        "p",
        `${recovery.reservation.path} · ${recovery.pathState === "present" ? "file still exists" : "file is missing"}`,
      );
      const resolution = recovery.pathState === "present" ? "abort" as const : "complete" as const;
      const label = resolution === "abort" ? "Abort stale delete" : "Finish deletion cleanup";
      row.append(actionButton(label, async () => {
        if (!ownerDocument.defaultView?.confirm(
          resolution === "abort"
            ? "Release this stale delete reservation because the file still exists?"
            : "Finish collaboration cleanup for this already deleted path?",
        )) return;
        await run(() => options.fileDeletionRecovery!.recover(
          recovery.reservation.operationId,
          resolution,
        ));
      }, { disabled: busy }));
      card.append(row);
    }
    body.append(card);
  };

  const renderEnrollmentMutationRecoveries = (): void => {
    if (enrollmentMutationRecoveries.length === 0) return;
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card nexus-collaboration__card--warning";
    appendText(card, "h3", "Incomplete enrollment cleanup");
    appendText(
      card,
      "p",
      "A previous window stopped while forgetting a local collaboration identity. Recovery is never run automatically across windows.",
    );
    for (const recovery of enrollmentMutationRecoveries) {
      const row = ownerDocument.createElement("div");
      row.className = "nexus-collaboration__danger-zone";
      appendText(
        row,
        "p",
        `${recovery.deletion.record.path} · Projection Base ${recovery.projectionState}`,
      );
      row.append(actionButton("Finish enrollment cleanup", async () => {
        if (!ownerDocument.defaultView?.confirm(
          "Finish forgetting this local collaboration identity? The file and remote document are not deleted.",
        )) return;
        await run(() => options.enrollmentMutationRecovery!.finish(recovery.deletion));
      }, { disabled: busy }));
      card.append(row);
    }
    body.append(card);
  };

  const renderPendingJoinRecoveries = (): void => {
    if (pendingJoinRecoveries.length === 0) return;
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card nexus-collaboration__card--warning";
    appendText(card, "h3", "Interrupted collaboration join");
    appendText(
      card,
      "p",
      "The Vault Host kept an exact join fence after a window stopped. Safe recovery never rewrites or deletes the Markdown file.",
    );
    for (const recovery of pendingJoinRecoveries) {
      const row = ownerDocument.createElement("div");
      row.className = "nexus-collaboration__danger-zone";
      appendText(
        row,
        "p",
        `${recovery.pending.enrollment.path} · document ${recovery.pending.enrollment.documentId} · ${statusValue(recovery.outcome)}`,
      );
      appendText(row, "p", recovery.message);
      if (recovery.hasProjectionMetadata) {
        appendText(
          row,
          "p",
          "Projection metadata exists, so this join cannot be abandoned. Retry safe recovery; after it completes, use the exact enrollment's Forget action if needed.",
        );
      } else {
        appendText(
          row,
          "p",
          "No Projection metadata proves whether the file was written. Paste the same invitation below to retry, or explicitly abandon only the local join coordination.",
        );
      }
      row.append(actionButton(
        "Retry safe recovery",
        () => run(async () => { await options.pendingJoinRecovery!.recover(); }),
        { disabled: busy, data: ["pendingJoinAction", "recover"] },
      ));
      if (recovery.canAbandon) {
        row.append(actionButton("Abandon pending join", async () => {
          if (!ownerDocument.defaultView?.confirm(
            "Abandon only this local pending join? This will not rewrite or delete the Markdown file, which may already contain projected shared content.",
          )) return;
          await run(() => options.pendingJoinRecovery!.abandon(recovery.pending.operationId));
        }, {
          className: "nexus-collaboration__danger",
          disabled: busy,
          data: ["pendingJoinAction", "abandon"],
        }));
      }
      card.append(row);
    }
    body.append(card);
  };

  const actionButton = (
    label: string,
    action: () => void | Promise<void>,
    options: { className?: string; disabled?: boolean; data?: readonly [string, string] } = {},
  ): HTMLButtonElement => button(ownerDocument, label, action, {
    ...options,
    onError: (cause) => {
      if (destroyed) return;
      uiError = nonSecretError(cause);
      render();
    },
  });

  const renderDiagnostic = (snapshot: CollaborationWorkspaceSnapshot): void => {
    const diagnostic = uiError ?? snapshot.diagnostic?.message;
    if (!diagnostic) return;
    const alert = appendText(body, "div", diagnostic, "nexus-collaboration__alert");
    alert.setAttribute("role", "alert");
  };

  const submitRow = (form: HTMLFormElement, label: string): void => {
    const row = ownerDocument.createElement("div");
    row.className = "nexus-collaboration__actions";
    const submit = ownerDocument.createElement("button");
    submit.type = "submit";
    submit.disabled = busy;
    submit.textContent = busy ? "Working…" : label;
    row.append(submit);
    form.append(row);
  };

  const renderResume = (file: CollaborationWorkspaceFile, record: CollaborationEnrollmentRecord): void => {
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card nexus-collaboration__card--primary";
    appendText(card, "h3", "Resume collaboration");
    appendText(card, "p", `${record.serverUrl} · ${record.access} · document ${record.documentId}`);
    const form = ownerDocument.createElement("form");
    form.dataset.collaborationForm = "resume";
    field(ownerDocument, form, {
      label: "User ID",
      name: "resume-user-id",
      value: drafts.resumeUserId,
      maxLength: 256,
      autocomplete: "username",
    });
    field(ownerDocument, form, {
      label: "Display name",
      name: "resume-display-name",
      value: drafts.resumeDisplayName,
      maxLength: 128,
      autocomplete: "name",
    });
    const token = field(ownerDocument, form, {
      label: `${record.access === "reader" ? "Reader" : "Editor"} token (kept in memory only)`,
      name: "resume-token",
      type: "password",
      maxLength: 8_192,
      autocomplete: "off",
    });
    submitRow(form, "Resume");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      drafts.resumeUserId = stringValue(form, "resume-user-id");
      drafts.resumeDisplayName = stringValue(form, "resume-display-name");
      const credential = token.value;
      token.value = "";
      void run(() => runOpening(file, (currentFile, assertContextCurrent) => options.workspace.resume({
          file: currentFile,
          credential: {
            token: credential,
            userId: drafts.resumeUserId,
            role: record.access === "reader" ? "reader" : "editor",
          },
          displayName: drafts.resumeDisplayName,
          assertContextCurrent,
        })));
    });
    const footer = ownerDocument.createElement("div");
    footer.className = "nexus-collaboration__danger-zone";
    appendText(footer, "p", "Forgetting removes only this local enrollment; it does not delete the file or remote document.");
    footer.append(actionButton("Forget enrollment", async () => {
      if (!ownerDocument.defaultView?.confirm("Forget this local collaboration enrollment?")) return;
      await run(async () => { await options.workspace.forget(file.path); });
    }, { className: "nexus-collaboration__danger" }));
    card.append(form, footer);
    body.append(card);
  };

  const clearCreateDraftForPath = (path: string): void => {
    if (drafts.createDocumentPath !== path) return;
    drafts.createDocumentPath = null;
    drafts.createDocumentId = "";
  };

  const renderPendingCreation = (
    file: CollaborationWorkspaceFile,
    record: CollaborationPendingCreationRecord,
  ): void => {
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card nexus-collaboration__card--warning";
    appendText(card, "h3", "Recover pending creation");
    appendText(
      card,
      "p",
      "Remote creation may have completed, but its local enrollment was not committed. Recover this exact identity before creating or joining another document.",
    );
    appendText(card, "p", `${record.serverUrl} · document ${record.documentId}`);
    const appendAbandonRecovery = (): void => {
      const danger = ownerDocument.createElement("div");
      danger.className = "nexus-collaboration__danger-zone";
      appendText(
        danger,
        "p",
        "Abandoning removes only this local recovery intent. It does not delete a remote document that may already exist.",
      );
      danger.append(actionButton("Abandon local recovery", async () => {
        if (!ownerDocument.defaultView?.confirm("Abandon this local creation recovery? The remote document will not be deleted.")) return;
        await run(async () => {
          await options.workspace.forgetPendingCreation(file.path);
          clearCreateDraftForPath(file.path);
        });
      }, { className: "nexus-collaboration__danger", disabled: busy }));
      card.append(danger);
    };

    if (options.workspace.canRetryPendingCreationWithoutCredential(file.path)) {
      const actions = ownerDocument.createElement("div");
      actions.className = "nexus-collaboration__actions";
      actions.append(actionButton("Retry enrollment and attach", () => run(async () => {
        await runOpening(file, (currentFile, assertContextCurrent) => options.workspace.retryPendingCreation({
          file: currentFile,
          assertContextCurrent,
        }));
        clearCreateDraftForPath(file.path);
      }), { disabled: busy, data: ["pendingAction", "retry"] }));
      card.append(actions);
      appendAbandonRecovery();
      body.append(card);
      return;
    }

    appendText(card, "p", "After restart, enter the owner credential again. It is kept in memory only.");
    const form = ownerDocument.createElement("form");
    form.dataset.collaborationForm = "pending-creation";
    field(ownerDocument, form, {
      label: "Owner user ID",
      name: "pending-user-id",
      value: drafts.pendingUserId,
      maxLength: 256,
      autocomplete: "username",
    });
    field(ownerDocument, form, {
      label: "Display name",
      name: "pending-display-name",
      value: drafts.pendingDisplayName,
      maxLength: 128,
      autocomplete: "name",
    });
    const token = field(ownerDocument, form, {
      label: "Owner token (kept in memory only)",
      name: "pending-token",
      type: "password",
      maxLength: 8_192,
      autocomplete: "off",
    });
    submitRow(form, "Recover and attach");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      drafts.pendingUserId = stringValue(form, "pending-user-id");
      drafts.pendingDisplayName = stringValue(form, "pending-display-name");
      const credential = token.value;
      token.value = "";
      void run(async () => {
        await runOpening(file, (currentFile, assertContextCurrent) => options.workspace.retryPendingCreation({
          file: currentFile,
          credential: {
            token: credential,
            userId: drafts.pendingUserId,
            role: "editor",
          },
          displayName: drafts.pendingDisplayName,
          assertContextCurrent,
        }));
        clearCreateDraftForPath(file.path);
      });
    });
    card.append(form);
    appendAbandonRecovery();
    body.append(card);
  };

  const renderCreate = (file: CollaborationWorkspaceFile): void => {
    ensureCreateDocumentId(file);
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card";
    appendText(card, "h3", "Create collaboration");
    appendText(card, "p", "Generate the writer credential on the trusted server for this exact Document ID, then paste only its token field here.");
    if (options.serverUrls) {
      appendText(card, "p", `Trusted servers: ${options.serverUrls.join(", ")}. Configure NEXUS_COLLAB_SERVERS and restart to change this list.`);
    }
    const form = ownerDocument.createElement("form");
    form.dataset.collaborationForm = "create";
    field(ownerDocument, form, {
      label: "WebSocket server",
      name: "create-server-url",
      value: drafts.createServerUrl,
      placeholder: "wss://collab.example.com",
      maxLength: 2_048,
      autocomplete: "url",
    });
    field(ownerDocument, form, {
      label: "Document ID",
      name: "create-document-id",
      value: drafts.createDocumentId,
      maxLength: 256,
      autocomplete: "off",
    });
    field(ownerDocument, form, {
      label: "User ID",
      name: "create-user-id",
      value: drafts.createUserId,
      maxLength: 256,
      autocomplete: "username",
    });
    field(ownerDocument, form, {
      label: "Display name",
      name: "create-display-name",
      value: drafts.createDisplayName,
      maxLength: 128,
      autocomplete: "name",
    });
    const token = field(ownerDocument, form, {
      label: "Editor token (kept in memory only)",
      name: "create-token",
      type: "password",
      maxLength: 8_192,
      autocomplete: "off",
    });
    submitRow(form, "Create and attach");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      drafts.createServerUrl = stringValue(form, "create-server-url");
      drafts.createDocumentId = stringValue(form, "create-document-id");
      drafts.createUserId = stringValue(form, "create-user-id");
      drafts.createDisplayName = stringValue(form, "create-display-name");
      const credential = token.value;
      token.value = "";
      const submittedPath = file.path;
      void run(async () => {
        await runOpening(file, (currentFile, assertContextCurrent) => options.workspace.create({
            file: currentFile,
            serverUrl: drafts.createServerUrl,
            documentId: asDocumentId(drafts.createDocumentId),
            credential: { token: credential, userId: drafts.createUserId, role: "editor" },
            displayName: drafts.createDisplayName,
            assertContextCurrent,
          }));
        if (drafts.createDocumentPath === submittedPath) {
          drafts.createDocumentPath = null;
          drafts.createDocumentId = "";
        }
      });
    });
    card.append(form);
    body.append(card);
  };

  const renderJoin = (file: CollaborationWorkspaceFile): void => {
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card";
    appendText(card, "h3", "Join collaboration");
    appendText(card, "p", "Invitation capabilities are short-lived JSON values. They are never opened as links or written to the Vault.");
    const form = ownerDocument.createElement("form");
    form.dataset.collaborationForm = "join";
    const invitation = textArea(ownerDocument, form, {
      label: "Invitation",
      name: "join-invitation",
      maxLength: 16_384,
      rows: 6,
    });
    const displayName = field(ownerDocument, form, {
      label: "Display name",
      name: "join-display-name",
      maxLength: 128,
      autocomplete: "name",
    });
    submitRow(form, "Validate and join");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const capability = invitation.value.trim();
      const name = displayName.value.trim();
      invitation.value = "";
      void run(() => runOpening(file, (currentFile, assertContextCurrent) => options.workspace.join({
          file: currentFile,
          invitation: capability,
          displayName: name,
          assertContextCurrent,
        })));
    });
    card.append(form);
    body.append(card);
  };

  const renderStatus = (snapshot: CollaborationWorkflowSnapshot, workspace: CollaborationWorkspaceSnapshot): void => {
    const grid = ownerDocument.createElement("dl");
    grid.className = "nexus-collaboration__status-grid";
    const rows: Array<[string, string]> = [
      ["Network", snapshot.collaboration.transport],
      ["Initial sync", snapshot.collaboration.sync],
      ["Authentication", snapshot.collaboration.authentication],
      ["Access", `${snapshot.access} / ${snapshot.collaboration.access}`],
      ["Local replica", snapshot.collaboration.persistence],
      ["Server sync", workspace.serverPersistence === "server-synchronized"
        ? "synchronized; per-update durable commit is not acknowledged by this protocol"
        : statusValue(workspace.serverPersistence)],
      ["Consistency", snapshot.collaboration.consistency],
      ["File projection", snapshot.projection.projection],
    ];
    for (const [name, value] of rows) {
      appendText(grid, "dt", name);
      appendText(grid, "dd", statusValue(value));
    }
    body.append(grid);
  };

  const renderConflict = (conflict: FileProjectionConflict, canEdit: boolean): void => {
    if (lastConflictId !== conflict.id) {
      lastConflictId = conflict.id;
      drafts.manualMerge = manualTemplate(conflict);
    }
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card nexus-collaboration__card--warning";
    appendText(card, "h3", "Markdown file conflict");
    appendText(card, "p", `Reason: ${statusValue(conflict.reason)}. Automatic file projection is paused.`);
    const columns = ownerDocument.createElement("div");
    columns.className = "nexus-collaboration__conflict-columns";
    for (const [label, value] of [["Projection base", conflict.base ?? "(none)"], ["Shared", conflict.live.markdown], ["Disk", conflict.incoming.markdown]] as const) {
      const column = ownerDocument.createElement("section");
      appendText(column, "h4", label);
      appendText(column, "pre", value);
      columns.append(column);
    }
    const actions = ownerDocument.createElement("div");
    actions.className = "nexus-collaboration__actions";
    actions.append(actionButton("Keep shared", () => run(() => options.workspace.resolveFileConflict({
      conflictId: conflict.id,
      choice: "use-live",
    })), { disabled: busy, data: ["conflictAction", "use-live"] }));
    card.append(columns, actions);
    if (!canEdit) {
      appendText(
        card,
        "p",
        "Read-only participants can keep shared content in this local file, but cannot replace the shared document from disk.",
      );
      body.append(card);
      return;
    }
    actions.append(actionButton("Use disk", () => run(() => options.workspace.resolveFileConflict({
        conflictId: conflict.id,
        choice: "use-disk",
      })), { disabled: busy, data: ["conflictAction", "use-disk"] }));
    const form = ownerDocument.createElement("form");
    form.className = "nexus-collaboration__manual-merge";
    const manual = textArea(ownerDocument, form, {
      label: "Manual merge",
      name: "manual-merge",
      value: drafts.manualMerge,
      maxLength: 64 * 1024 * 1024,
      rows: 10,
    });
    submitRow(form, "Apply manual merge");
    form.addEventListener("input", () => { drafts.manualMerge = manual.value; });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      drafts.manualMerge = manual.value;
      void run(() => options.workspace.resolveFileConflict({
        conflictId: conflict.id,
        choice: "manual",
        markdown: drafts.manualMerge,
      }));
    });
    card.append(form);
    body.append(card);
  };

  const renderInvitation = (): void => {
    if (!drafts.issuedInvitation) return;
    const card = ownerDocument.createElement("section");
    card.className = "nexus-collaboration__card nexus-collaboration__card--capability";
    appendText(card, "h3", "Invitation capability");
    appendText(card, "p", "Share through a trusted channel. Clear it when finished; anyone holding it has its stated access until expiry.");
    const value = ownerDocument.createElement("textarea");
    value.readOnly = true;
    value.rows = 5;
    value.value = drafts.issuedInvitation;
    value.setAttribute("aria-label", "Invitation capability");
    const actions = ownerDocument.createElement("div");
    actions.className = "nexus-collaboration__actions";
    actions.append(
      actionButton("Copy", async () => {
        await ownerDocument.defaultView?.navigator.clipboard?.writeText(drafts.issuedInvitation);
      }),
      actionButton("Clear", () => {
        drafts.issuedInvitation = "";
        render();
      }),
    );
    card.append(value, actions);
    body.append(card);
  };

  const renderActive = (workspace: CollaborationWorkspaceSnapshot): void => {
    const snapshot = workspace.session!;
    const summary = ownerDocument.createElement("section");
    summary.className = "nexus-collaboration__summary";
    appendText(summary, "h3", workspace.enrollment?.title ?? snapshot.file.path);
    appendText(summary, "p", `${workspace.enrollment?.serverUrl ?? "Server"} · document ${snapshot.documentId}`);
    body.append(summary);
    renderStatus(snapshot, workspace);

    const peers = ownerDocument.createElement("section");
    peers.className = "nexus-collaboration__card";
    appendText(peers, "h3", `Participants (${snapshot.peers.length + 1})`);
    const list = ownerDocument.createElement("ul");
    const self = ownerDocument.createElement("li");
    self.textContent = `You · ${snapshot.access}`;
    list.append(self);
    for (const peer of snapshot.peers) {
      const item = ownerDocument.createElement("li");
      item.textContent = `${peer.name} · online`;
      list.append(item);
    }
    peers.append(list);
    body.append(peers);

    if (workspace.attachment === "content-mismatch") {
      const card = ownerDocument.createElement("section");
      card.className = "nexus-collaboration__card nexus-collaboration__card--warning";
      appendText(card, "h3", "Editor content differs");
      appendText(card, "p", "Nothing has been overwritten. Continue only if replacing this Editor with the synchronized shared document is intended.");
      card.append(actionButton("Use synchronized shared content", () => run(() => options.workspace.useSharedContent()), { disabled: busy }));
      body.append(card);
    }

    const conflict = snapshot.projection.conflict;
    if (conflict) renderConflict(conflict, snapshot.capabilities.canEdit);

    const actions = ownerDocument.createElement("section");
    actions.className = "nexus-collaboration__card";
    appendText(actions, "h3", "Session actions");
    const row = ownerDocument.createElement("div");
    row.className = "nexus-collaboration__actions";
    if (snapshot.capabilities.canRetryConnection) {
      row.append(actionButton("Reconnect", () => run(() => options.workspace.retryConnection()), { disabled: busy }));
    }
    if (snapshot.capabilities.canRetryPersistence) {
      row.append(actionButton(
        "Retry local persistence",
        () => run(() => options.workspace.retryPersistence()),
        { disabled: busy, data: ["sessionAction", "retry-persistence"] },
      ));
    }
    if (snapshot.capabilities.canRetryProjection) {
      row.append(actionButton("Retry file projection", () => run(() => options.workspace.retryFileProjection()), { disabled: busy }));
    }
    if (snapshot.capabilities.canInvite) {
      for (const role of ["reader", "editor"] as const) {
        row.append(actionButton(`Create ${role} invite`, async () => {
          if (busy) return;
          busy = true;
          uiError = null;
          render();
          try {
            const invitation = await options.workspace.createInvite(role);
            drafts.issuedInvitation = invitation.value;
          } catch (cause) {
            uiError = nonSecretError(cause);
          } finally {
            busy = false;
            render();
          }
        }, { disabled: busy }));
      }
    }
    row.append(actionButton("Leave collaboration", () => run(
      () => options.workspace.leave(),
      () => { drafts.issuedInvitation = ""; },
    ), { disabled: busy }));
    actions.append(row);

    if (snapshot.capabilities.canReauthenticate && workspace.enrollment) {
      const membershipAccess = workspace.enrollment.access;
      const form = ownerDocument.createElement("form");
      form.className = "nexus-collaboration__reauth";
      const userId = field(ownerDocument, form, {
        label: "User ID",
        name: "reauth-user-id",
        value: drafts.resumeUserId,
        maxLength: 256,
        autocomplete: "username",
      });
      const token = field(ownerDocument, form, {
        label: "Replacement token (memory only)",
        name: "reauth-token",
        type: "password",
        maxLength: 8_192,
        autocomplete: "off",
      });
      submitRow(form, "Reauthenticate");
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const nextToken = token.value;
        token.value = "";
        drafts.resumeUserId = userId.value.trim();
        void run(() => options.workspace.reauthenticate({
          token: nextToken,
          userId: drafts.resumeUserId,
          // Revocation changes session access, not the retained Enrollment role.
          role: membershipAccess === "reader" ? "reader" : "editor",
        }));
      });
      actions.append(form);
    }

    const danger = ownerDocument.createElement("details");
    danger.className = "nexus-collaboration__danger-zone";
    const dangerSummary = ownerDocument.createElement("summary");
    dangerSummary.textContent = "Unresolved projection recovery";
    appendText(danger, "p", "Discarding unprojected state closes this session without changing the existing file or deleting the remote document. Durable local CRDT history remains in the local store.");
    danger.prepend(dangerSummary);
    danger.append(actionButton("Leave and discard unprojected state", async () => {
      if (!ownerDocument.defaultView?.confirm("Leave even though the Markdown projection is unresolved?")) return;
      await run(
        () => options.workspace.leave({ discardUnprojected: true }),
        () => { drafts.issuedInvitation = ""; },
      );
    }, { className: "nexus-collaboration__danger", disabled: busy }));
    actions.append(danger);
    body.append(actions);
    renderInvitation();
  };

  const render = (): void => {
    if (destroyed) return;
    body.replaceChildren();
    const snapshot = options.workspace.getState();
    renderDiagnostic(snapshot);
    renderPendingJoinRecoveries();
    renderFileDeletionRecoveries();
    renderEnrollmentMutationRecoveries();
    if (snapshot.phase === "active" || snapshot.phase === "leaving") {
      if (snapshot.session) renderActive(snapshot);
      return;
    }
    const file = options.getCurrentFile();
    if (!file) {
      const empty = ownerDocument.createElement("section");
      empty.className = "nexus-collaboration__empty";
      appendText(empty, "h3", "Open a Markdown file from a runtime Vault");
      appendText(empty, "p", "Collaboration enrollment is scoped to a stable Vault file identity.");
      body.append(empty);
    } else {
      const context = ownerDocument.createElement("section");
      context.className = "nexus-collaboration__summary";
      appendText(context, "h3", file.title);
      appendText(context, "p", file.path);
      if (options.isCurrentFileDirty()) {
        appendText(context, "p", "This Editor has unsaved local changes. Creating or joining may require an explicit reconciliation before attachment.", "nexus-collaboration__warning");
      }
      body.append(context);
      if (enrollmentPath !== file.path || pendingCreationPath !== file.path) {
        const loading = ownerDocument.createElement("section");
        loading.className = "nexus-collaboration__empty";
        appendText(loading, "p", "Loading collaboration enrollment…");
        body.append(loading);
      } else if (pendingCreation) renderPendingCreation(file, pendingCreation);
      else if (enrollment) renderResume(file, enrollment);
      else {
        const choices = ownerDocument.createElement("div");
        choices.className = "nexus-collaboration__enrollment-grid";
        body.append(choices);
        const before = body.children.length;
        renderCreate(file);
        renderJoin(file);
        const created = Array.from(body.children).slice(before);
        choices.append(...created);
      }
    }
    if (options.openDeveloperLab) {
      const developer = ownerDocument.createElement("footer");
      developer.className = "nexus-collaboration__developer";
      appendText(developer, "p", "Developer diagnostics use a separate volatile two-editor assessment transport and are not product evidence.");
      developer.append(actionButton("Open developer lab", () => options.openDeveloperLab?.()));
      body.append(developer);
    }
  };

  const unsubscribe = options.workspace.subscribe(() => render());
  const panel: CollaborationPanel = {
    element: overlay,
    async open() {
      if (destroyed) throw new Error("Collaboration panel is destroyed");
      overlay.hidden = false;
      await refreshEnrollment();
      render();
    },
    async refreshFile() {
      if (destroyed) return;
      drafts.issuedInvitation = "";
      lastConflictId = null;
      await refreshEnrollment();
      render();
    },
    hide() {
      drafts.issuedInvitation = "";
      overlay.hidden = true;
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      drafts.issuedInvitation = "";
      unsubscribe();
      overlay.remove();
    },
  };
  render();
  return panel;
}
