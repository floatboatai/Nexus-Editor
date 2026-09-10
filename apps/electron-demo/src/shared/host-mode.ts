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
  return env.NEXUS_PLUGIN_PLATFORM === "0" || env.VITE_NEXUS_PLUGIN_PLATFORM === "0"
    ? "legacy"
    : "runtime";
}
