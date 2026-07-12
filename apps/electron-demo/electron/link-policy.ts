/**
 * Navigation policy for editor windows, kept free of electron imports so it
 * can be unit-tested: web and mail links leave the app via the system
 * browser, nothing else may open windows or navigate the editor away.
 */

/** The URL to hand to shell.openExternal, or null when nothing may open. */
export function externalTarget(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url) ? url : null;
}

/**
 * Whether an in-place navigation may proceed. Only renderer-initiated
 * reloads of the current page qualify (location.reload(), vite full-reload
 * in dev) — webContents.reload() never emits will-navigate at all.
 */
export function isSamePageReload(url: string, currentUrl: string): boolean {
  return url === currentUrl;
}
