/**
 * Collaboration UI — headless, host-rendered.
 *
 * Following Nexus' headless contract, the plugin only computes and pushes
 * strings/handles; the host renders them in its own UI slots. We surface:
 *   - a status-bar indicator (online / offline-queued (N bytes) / merging)
 *   - an avatar stack of present collaborators
 *   - a conflict toast (when a merge needs human attention)
 *   - a share dialog (export / import snapshot)
 */

import type { AwarenessState } from "../provider/adapter";

export type ConnectionState = "online" | "offline-queued" | "merging";

/** Structural subset of the public UiService the plugin relies on. */
export interface HostUi {
  registerAction(
    slot: "status-bar",
    def: { id: string; label: string; ariaLabel?: string; tooltip?: string; visible?: () => boolean; action?: () => void },
  ): { ok: boolean; registration?: { update(s: { label?: string; ariaLabel?: string }): void }; diagnostic?: unknown };
  openModal?(def: { title: string; body: string; actions?: Array<{ label: string; run?: () => void }> }): unknown;
}

export interface CollabUiModel {
  connection: ConnectionState;
  queuedBytes: number;
  peers: readonly AwarenessState[];
  conflict?: string;
}

export interface CollabUiHandle {
  update(model: CollabUiModel): void;
  destroy(): void;
}

export function mountCollabUI(ui: HostUi, opts: { shareExport: () => string; shareImport: (s: string) => void }): CollabUiHandle {
  const result = ui.registerAction("status-bar", {
    id: "collab-status",
    label: "● online",
    ariaLabel: "Collaboration status: online",
    tooltip: "Collaboration",
    action: () => {
      const snapshot = opts.shareExport();
      ui.openModal?.({
        title: "Share / Session snapshot",
        body: snapshot,
        actions: [{ label: "Close" }],
      });
    },
  });
  const registration = result.ok ? result.registration : undefined;

  return {
    update(model: CollabUiModel) {
      const label =
        model.connection === "online"
          ? `● ${model.peers.filter((p) => p.clientId !== "local").length + 1} online`
          : model.connection === "offline-queued"
            ? `◐ offline · ${model.queuedBytes}B queued`
            : "⟳ merging";
      registration?.update({
        label,
        ariaLabel: `Collaboration status: ${model.connection}`,
      });
    },
    destroy() {
      /* registration is auto-reclaimed by the runtime on unload */
    },
  };
}
