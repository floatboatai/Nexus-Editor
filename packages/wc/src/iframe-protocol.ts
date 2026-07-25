export const NEXUS_IFRAME_PROTOCOL = "nexus-editor-iframe";
export const NEXUS_IFRAME_PROTOCOL_VERSION = 1;

export type NexusIframeMethod = "getDocument" | "setDocument" | "focus";

export interface NexusIframeProbeMessage {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: "probe";
}

export interface NexusIframeRuntimeReadyMessage {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: "runtime-ready";
  runtimeId: string;
}

export interface NexusIframeConnectMessage {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: "connect";
  runtimeId: string;
}

export interface NexusIframeRequestMessage {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: "request";
  id: number;
  method: NexusIframeMethod;
  value?: string;
}

export interface NexusIframeResponseMessage {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: "response";
  id: number;
  ok: boolean;
  result?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface NexusIframeReadyEvent {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: "ready";
}

export interface NexusIframeChangeEvent {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: "change";
  doc: string;
}

export interface NexusIframeDestroyMessage {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: "destroy";
}

export type NexusIframeDiscoveryMessage =
  | NexusIframeProbeMessage
  | NexusIframeRuntimeReadyMessage
  | NexusIframeConnectMessage;

export type NexusIframePortMessage =
  | NexusIframeRequestMessage
  | NexusIframeResponseMessage
  | NexusIframeReadyEvent
  | NexusIframeChangeEvent
  | NexusIframeDestroyMessage;

export function isProtocolMessage(value: unknown): value is Record<string, unknown> & {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
  type: string;
} {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return message.protocol === NEXUS_IFRAME_PROTOCOL &&
    message.version === NEXUS_IFRAME_PROTOCOL_VERSION &&
    typeof message.type === "string";
}

export function assertExactOrigin(origin: string, optionName: string): void {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new TypeError(`${optionName} must be an absolute origin.`);
  }
  if (origin === "*" || parsed.origin === "null" || parsed.origin !== origin) {
    throw new TypeError(`${optionName} must be an exact, non-opaque origin without a path.`);
  }
}

export function createProtocolMessage<T extends object>(message: T): T & {
  protocol: typeof NEXUS_IFRAME_PROTOCOL;
  version: typeof NEXUS_IFRAME_PROTOCOL_VERSION;
} {
  return {
    protocol: NEXUS_IFRAME_PROTOCOL,
    version: NEXUS_IFRAME_PROTOCOL_VERSION,
    ...message,
  };
}
