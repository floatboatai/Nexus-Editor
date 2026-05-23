/**
 * Pure helpers for Vue controlled-document sync (tested in isolation).
 */

export function isControlledDocument(modelValue: string | undefined): boolean {
  return modelValue !== undefined;
}

export function resolveInitialDocument(
  modelValue: string | undefined,
  initialValue: string | undefined
): string {
  return modelValue !== undefined ? modelValue : (initialValue ?? "");
}

export function shouldSyncControlledDocument(
  next: string,
  lastSynced: string | null
): boolean {
  return lastSynced !== next;
}
