import type {
  AuthorPluginManifest,
  CapabilityRegistry,
  CommandService,
  NexusApp,
  NexusPluginConstructor,
} from "../dist/index";

declare const capabilities: CapabilityRegistry;
declare const Plugin: NexusPluginConstructor;

const manifest = {
  id: "api-consumer",
  name: "API Consumer",
  version: "1.0.0",
  entrypoint: "main.js",
  apiVersion: "^1.0.0",
} satisfies AuthorPluginManifest;

const app = {
  capabilities,
} as NexusApp;

void new Plugin(app, manifest as never);

declare const commands: CommandService;
void commands.executeCommand("formatting:inline-code", { signal: new AbortController().signal });
