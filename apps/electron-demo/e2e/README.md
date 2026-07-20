# Electron E2E tests

The suite launches the packaged Electron main process from
`dist-electron/main.js`; it does not use a Vite development server. It covers
the critical editor path: application startup, Markdown editing with undo/redo,
and opening, saving, and reopening a Markdown file.

Run the tests from the repository root:

```bash
pnpm build
pnpm build:electron-demo
pnpm test:e2e
```

Each test receives an isolated Electron user-data directory and temporary
workspace. Native file dialogs are stubbed in the Electron main process, so
the file lifecycle test uses real file IO without depending on an operating
system dialog. The fixture captures renderer console errors and preserves
Playwright traces and screenshots when a test fails.

The suite launches the Electron binary supplied by the `electron` dependency;
it does not download or launch a separate Playwright browser.

The Playwright Electron API is experimental. After upgrading `@playwright/test`,
rerun the full E2E suite and validate the GitHub Actions job before relying on
the upgrade.
