import type { EditorAPI } from "@floatboat/nexus-core";
import {
  UI_CAPABILITY,
  WORKSPACE_CAPABILITY,
  type NexusDiagnostic,
  type UiService,
  type WindowId,
  type WorkspaceId,
  type WorkspaceService,
} from "@floatboat/nexus-plugin-api";
import {
  DiagnosticBus,
  EditorHostRegistry,
  RuntimeCapabilityRegistry,
  RuntimeUiHost,
  RuntimeWorkspace,
  type EditorHostAttachment,
  type OwnerBoundCapabilityFactory,
  type PluginManagerOptions,
  type RuntimeUiHostOptions,
  type RuntimeWorkspaceOptions,
} from "../dist/index";

const capabilities = new RuntimeCapabilityRegistry();
const diagnostics = new DiagnosticBus();
const options = {} as PluginManagerOptions;
const report: readonly NexusDiagnostic[] = diagnostics.diagnostics;

function createOptionalHosts(ownerDocument: Document) {
  const workspaceOptions: RuntimeWorkspaceOptions = {
    markdownViewType: "custom-host:markdown",
    supportedContainers: ["root", "tab"],
  };
  const uiOptions: RuntimeUiHostOptions = {
    renderIcon: (icon, targetDocument) => icon.id === "custom-host:mark"
      ? targetDocument.createElement("span")
      : null,
  };
  return {
    workspace: new RuntimeWorkspace(ownerDocument, workspaceOptions),
    ui: new RuntimeUiHost(uiOptions),
  };
}

function attachWithoutWorkspace(editor: EditorAPI, root: HTMLElement): EditorHostAttachment {
  return new EditorHostRegistry().attach({ editor, surface: { kind: "document", root } });
}

function registerCustomServices(
  workspaceId: WorkspaceId,
  windowId: WindowId,
  createWorkspace: OwnerBoundCapabilityFactory<WorkspaceService>,
  createUi: OwnerBoundCapabilityFactory<UiService>,
) {
  return [
    capabilities.registerOwnerBound(WORKSPACE_CAPABILITY, createWorkspace, {
      context: { workspaceId },
    }),
    capabilities.registerOwnerBound(UI_CAPABILITY, createUi, {
      context: { windowId },
    }),
  ];
}

void capabilities;
void options;
void report;
void createOptionalHosts;
void attachWithoutWorkspace;
void registerCustomServices;
