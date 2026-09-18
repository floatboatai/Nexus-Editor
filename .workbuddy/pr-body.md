## Summary

Two things in one branch: a visual redesign of the Electron demo shell with full zh-CN/en localization, and a fix for the Windows-only failures in the plugin-host security test suite.

## UI redesign + i18n

- **New `src/renderer/i18n.ts`**: en + zh-CN dictionaries, `t()` with `{param}` interpolation, live bindings (`bindText` / `bindTitle` / `bindPlaceholder`) that re-translate in place on locale change, locale persisted to `localStorage` and defaulting to `navigator.language`.
- **Two ways to switch language**: a toolbar pill button (`中` / `EN`) and a new *Language* row in the settings panel. Switching is instant — no restart, no remount. Panels, context menus and placeholders all refresh live.
- **Translated every demo UI string**: toolbar, status bar, settings panel, vault panel (including context menu), outline panel, backlinks panel, search bar, editor hints (`image not found`, `View source`, `Drag to resize`).
- **New stylesheet** (`style.css`): brand gradient in the toolbar, ghost buttons, language pill, softer borders/radii, tidier status bar with pills, menu pop-in animation, refreshed syntax colors. Everything still consumes the `--nexus-*` theme variables, so dark mode keeps working.

## Windows test fixes

`plugin-host-broker.test.ts` assumed `fs.symlink()` can create working links. On Windows without elevation and without Developer Mode, a file symlink created by Node is a dead link (`lstat`/`realpath` → `ENOENT`), so the escape-prevention tests failed with `ENOENT` instead of `vault-path-escape`.

- Directory links now use a `symlinkDirectory()` helper that falls back to a **junction** on Windows (no privilege required).
- Leaf swaps use `swapLeafOutside()`, which uses a **hard link** on Windows — the broker still rejects it via inode identity check, so the security semantics are unchanged.
- `O_NONBLOCK` assertion guarded for platforms where the constant is `undefined`, matching the existing `O_NOFOLLOW` guard.

Also relaxed two load-sensitive checks that were flaky under concurrent test load:

- `app-runtime-integration.test.ts`: the two full-boot integration tests get a 15s timeout (a 5s timeout also leaked DOM state into the next test, producing a phantom "two slash menus" failure).
- `release-gates.test.ts` perf baseline: `maximumElapsedMs` 5000 → 10000 (measured 5113ms under load; the fixture comment already describes this as a coarse regression guard).

## Testing

- `node node_modules/vitest/vitest.mjs run` → **898/898 passing**
- `tsc --noEmit` on `apps/electron-demo` → clean
