/**
 * Pure helpers for controlled-document sync (tested in isolation).
 */

export function isControlledDocument(value: string | undefined): boolean {
  return value !== undefined;
}

export function resolveInitialDocument(
  value: string | undefined,
  initialValue: string | undefined
): string {
  return value !== undefined ? value : (initialValue ?? "");
}

/** Whether an external `value` update should trigger silent setDocument. */
export function shouldSyncControlledDocument(
  next: string,
  lastSynced: string | null
): boolean {
  return lastSynced !== next;
}
