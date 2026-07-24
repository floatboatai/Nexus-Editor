/**
 * Pure helpers for controlled-document sync (tested in isolation).
 * Mirrors packages/react/src/controlled-document.ts so all bindings agree on
 * the same controlled/uncontrolled semantics.
 */

export function isControlledDocument(value: string | undefined | null): boolean {
  return value !== undefined && value !== null;
}

export function resolveInitialDocument(
  value: string | undefined | null,
  initialValue: string | undefined | null
): string {
  return isControlledDocument(value) ? (value as string) : (initialValue ?? "");
}

/** Whether an external `value` update should trigger a silent setDocument. */
export function shouldSyncControlledDocument(
  next: string,
  lastSynced: string | null
): boolean {
  return lastSynced !== next;
}
