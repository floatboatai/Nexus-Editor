import { resolveMessages, type MessageId } from "./messages";

let dict = resolveMessages("en");
const listeners = new Set<() => void>();

/** Replace `{name}`-style placeholders in a string. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}

export function setUiLocale(bcp47: string): void {
  dict = resolveMessages(bcp47);
  for (const cb of listeners) cb();
}

export function t(id: MessageId, vars?: Record<string, string | number>): string {
  return interpolate(dict[id] ?? id, vars);
}

export function subscribeLocale(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
