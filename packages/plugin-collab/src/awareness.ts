import type { Awareness } from "y-protocols/awareness";
import type { CollabUser } from "./types";

export const DEFAULT_USER_PALETTES: Array<{ color: string; colorLight: string }> = [
  { color: "#2563eb", colorLight: "rgba(37, 99, 235, 0.18)" },
  { color: "#7c3aed", colorLight: "rgba(124, 58, 237, 0.18)" },
  { color: "#db2777", colorLight: "rgba(219, 39, 119, 0.18)" },
  { color: "#ea580c", colorLight: "rgba(234, 88, 12, 0.18)" },
  { color: "#059669", colorLight: "rgba(5, 150, 105, 0.18)" },
  { color: "#0891b2", colorLight: "rgba(8, 145, 178, 0.18)" },
  { color: "#d97706", colorLight: "rgba(217, 119, 6, 0.18)" },
];

/**
 * Assigns an aesthetic random user color palette.
 */
export function getRandomUserPalette(): { color: string; colorLight: string } {
  const index = Math.floor(Math.random() * DEFAULT_USER_PALETTES.length);
  return DEFAULT_USER_PALETTES[index];
}

/**
 * Publishes the local user's metadata (name, color, avatar) into the Yjs Awareness instance.
 */
export function setUserAwareness(awareness: Awareness, user: CollabUser): void {
  const palette = user.color ? { color: user.color, colorLight: user.colorLight ?? `${user.color}33` } : getRandomUserPalette();
  awareness.setLocalStateField("user", {
    name: user.name || "Anonymous",
    color: palette.color,
    colorLight: palette.colorLight,
    avatar: user.avatar,
  });
}
