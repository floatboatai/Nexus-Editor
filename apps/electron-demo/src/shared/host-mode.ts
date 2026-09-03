export type NexusHostMode = "legacy" | "runtime";

export const NEXUS_HOST_MODE_ARGUMENT_PREFIX = "--nexus-host-mode=";

export function hostModeArgument(mode: NexusHostMode): string {
  return `${NEXUS_HOST_MODE_ARGUMENT_PREFIX}${mode}`;
}

export function parseHostModeArgument(argv: readonly string[]): NexusHostMode {
  const value = argv
    .filter((argument) => argument.startsWith(NEXUS_HOST_MODE_ARGUMENT_PREFIX))
    .at(-1)
    ?.slice(NEXUS_HOST_MODE_ARGUMENT_PREFIX.length);
  return value === "runtime" ? "runtime" : "legacy";
}

export function resolveMainHostMode(
  env: Readonly<Record<string, string | undefined>>,
): NexusHostMode {
  const configured = env.NEXUS_PLUGIN_PLATFORM ?? env.VITE_NEXUS_PLUGIN_PLATFORM;
  if (configured === undefined || configured === "1") return "runtime";
  if (configured === "0") return "legacy";
  throw new RangeError(
    "NEXUS_PLUGIN_PLATFORM must be either '1' (runtime) or '0' (legacy)",
  );
}
