/**
 * Zero-trust security surface.
 *
 * Remote content is never trusted: awareness identity fields are whitelisted
 * and length-capped (prevents XSS via crafted names / avatar URLs), and room
 * membership is gated by an async `authorize(roomId)` hook the HOST implements
 * — the plugin never decides authorization itself.
 */

import type { AwarenessState } from "./provider/adapter";

const NAME_MAX = 64;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const URL_MAX = 2048;

export interface AuthorizeHook {
  (roomId: string): Promise<boolean> | boolean;
}

const ALLOWED_KEYS: ReadonlySet<keyof AwarenessState> = new Set([
  "clientId",
  "caret",
  "selection",
  "name",
  "color",
  "avatarUrl",
]);

/** Defensive normalization of an untrusted remote awareness payload. */
export function sanitizeAwareness(input: unknown): AwarenessState | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const out: Partial<AwarenessState> = {};
  for (const key of ALLOWED_KEYS) {
    if (!(key in raw)) continue;
    const value = raw[key];
    switch (key) {
      case "name":
        if (typeof value === "string") out.name = value.slice(0, NAME_MAX);
        break;
      case "color":
        if (typeof value === "string" && COLOR_RE.test(value)) out.color = value;
        else out.color = "#888888";
        break;
      case "avatarUrl":
        if (typeof value === "string" && value.length <= URL_MAX && /^https?:$/.test(new URL(value).protocol)) {
          out.avatarUrl = value;
        }
        break;
      case "caret":
        if (typeof value === "number" && Number.isFinite(value)) out.caret = Math.max(0, Math.floor(value));
        break;
      case "selection":
        if (Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === "number")) {
          out.selection = [Math.floor(value[0]), Math.floor(value[1])];
        }
        break;
      default:
        break;
    }
  }
  if (!out.name) out.name = "anonymous";
  if (!out.color) out.color = "#888888";
  if (typeof raw.clientId === "string") out.clientId = raw.clientId.slice(0, NAME_MAX);
  else out.clientId = "unknown";
  return out as AwarenessState;
}

/** Throws if the host denies access to a room. Host-supplied hook. */
export async function guardRoomAccess(roomId: string, authorize?: AuthorizeHook): Promise<void> {
  if (!authorize) return; // no policy -> open (host choice)
  const allowed = await authorize(roomId);
  if (!allowed) {
    throw new Error(`collab: access denied to room "${roomId}"`);
  }
}
