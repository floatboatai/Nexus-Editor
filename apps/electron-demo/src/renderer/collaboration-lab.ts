import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import {
  asDocumentId,
  createCollaborationEngine,
  type CollaborationEngine,
  type CollaborativeDocumentHandle,
  type EditorBindingHandle,
  type Unsubscribe,
} from "@floatboat/nexus-plugin-collab";
import { createAssessmentProviderHub } from "@floatboat/nexus-plugin-collab/assessment";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

const DEMO_MARKDOWN = `# Realtime collaboration lab

Edit either pane. The other pane converges through the assessment Provider.

| Participant | Status |
| --- | --- |
| Left | Ready |
| Right | Ready |`;

export interface CollaborationLab {
  readonly element: HTMLElement;
  readonly leftEditor: EditorAPI;
  readonly rightEditor: EditorAPI;
  destroy(): Promise<void>;
}

export async function createCollaborationLab(
  ownerDocument: Document = document,
  onClose?: () => void,
): Promise<CollaborationLab> {
  const overlay = ownerDocument.createElement("div");
  overlay.className = "nexus-collab-lab";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "nexus-collab-lab-title");

  const dialog = ownerDocument.createElement("section");
  dialog.className = "nexus-collab-lab__dialog";
  const header = ownerDocument.createElement("header");
  const heading = ownerDocument.createElement("div");
  const title = ownerDocument.createElement("h2");
  title.id = "nexus-collab-lab-title";
  title.textContent = "Realtime collaboration lab";
  const warning = ownerDocument.createElement("p");
  warning.textContent = "Experimental · local assessment transport · volatile memory only · no authentication or crash recovery";
  heading.append(title, warning);
  const closeButton = ownerDocument.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", "Close collaboration lab");
  header.append(heading, closeButton);

  const status = ownerDocument.createElement("div");
  status.className = "nexus-collab-lab__status";
  const panes = ownerDocument.createElement("div");
  panes.className = "nexus-collab-lab__panes";
  const leftPane = ownerDocument.createElement("article");
  const rightPane = ownerDocument.createElement("article");
  const leftLabel = ownerDocument.createElement("h3");
  const rightLabel = ownerDocument.createElement("h3");
  leftLabel.textContent = "Editor A";
  rightLabel.textContent = "Editor B";
  const leftRoot = ownerDocument.createElement("div");
  const rightRoot = ownerDocument.createElement("div");
  leftRoot.className = "nexus-collab-lab__editor";
  rightRoot.className = "nexus-collab-lab__editor";
  leftPane.append(leftLabel, leftRoot);
  rightPane.append(rightLabel, rightRoot);
  panes.append(leftPane, rightPane);
  dialog.append(header, status, panes);
  overlay.append(dialog);

  const hub = createAssessmentProviderHub();
  const leftEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
  const rightEngine = createCollaborationEngine({ providers: hub.factory, store: { mode: "volatile" } });
  const ref = {
    id: asDocumentId("01999199-65d3-7c89-bd21-collaboration-lab"),
    hostIdentity: "electron-assessment-lab",
    title: "Collaboration Lab",
  };
  let leftDocument: CollaborativeDocumentHandle | null = null;
  let rightDocument: CollaborativeDocumentHandle | null = null;
  let leftBinding: EditorBindingHandle | null = null;
  let rightBinding: EditorBindingHandle | null = null;
  let leftEditor: EditorAPI | null = null;
  let rightEditor: EditorAPI | null = null;
  const subscriptions: Unsubscribe[] = [];
  let destroyed = false;

  const refreshStatus = (): void => {
    if (!leftDocument || !rightDocument || destroyed) return;
    const left = leftDocument.getState();
    const right = rightDocument.getState();
    status.textContent = [
      `A: ${left.transport}/${left.sync}`,
      `B: ${right.transport}/${right.sync}`,
      `peers: ${Math.max(left.peers.length, right.peers.length)}`,
      "persistence: volatile",
    ].join(" · ");
  };

  const cleanup = async (): Promise<void> => {
    if (destroyed) return;
    destroyed = true;
    subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
    await leftBinding?.detach();
    await rightBinding?.detach();
    leftEditor?.destroy();
    rightEditor?.destroy();
    await leftDocument?.close();
    await rightDocument?.close();
    await leftEngine.close();
    await rightEngine.close();
    await hub.close();
    overlay.remove();
  };

  closeButton.addEventListener("click", () => {
    void cleanup().finally(() => onClose?.());
  });

  try {
    leftDocument = await leftEngine.create(ref, { initialMarkdown: DEMO_MARKDOWN });
    rightDocument = await rightEngine.open(ref);
    leftEditor = createEditor({
      container: leftRoot,
      initialValue: DEMO_MARKDOWN,
      livePreview: true,
      plugins: [createGfmPreset()],
    });
    rightEditor = createEditor({
      container: rightRoot,
      initialValue: DEMO_MARKDOWN,
      livePreview: true,
      plugins: [createGfmPreset()],
    });
    leftBinding = await leftDocument.attach(leftEditor, { content: "require-match" });
    rightBinding = await rightDocument.attach(rightEditor, { content: "require-match" });
    leftBinding.setPresence({ userId: "assessment-left", name: "Editor A", color: "#7c6cfa" });
    rightBinding.setPresence({ userId: "assessment-right", name: "Editor B", color: "#0f9d7a" });
    subscriptions.push(leftDocument.subscribe(refreshStatus), rightDocument.subscribe(refreshStatus));
    refreshStatus();
  } catch (error) {
    await cleanup();
    throw error;
  }

  return {
    element: overlay,
    leftEditor,
    rightEditor,
    destroy: cleanup,
  };
}
