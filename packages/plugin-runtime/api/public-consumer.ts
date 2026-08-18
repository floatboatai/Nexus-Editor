import type { NexusDiagnostic } from "@floatboat/nexus-plugin-api";
import {
  DiagnosticBus,
  RuntimeCapabilityRegistry,
  createMarkdownTransformMonitor,
  type MarkdownTransformMonitorOptions,
  type PluginManagerOptions,
} from "../dist/index";

const capabilities = new RuntimeCapabilityRegistry();
const diagnostics = new DiagnosticBus();
const options = {} as PluginManagerOptions;
const report: readonly NexusDiagnostic[] = diagnostics.diagnostics;
const monitorOptions = {} as MarkdownTransformMonitorOptions;
const monitor = createMarkdownTransformMonitor(monitorOptions);

void capabilities;
void options;
void report;
void monitor;
