const path = require("node:path");
const { app } = require("electron");

const TARGET_WIDTHS = [900, 761, 759, 578, 519, 480, 578];
const userData = process.env.NEXUS_ELECTRON_SIDEBAR_SMOKE_USER_DATA;
if (userData) app.setPath("userData", userData);

let targetWindow = null;
let completed = false;
const diagnostics = [];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function openDockedDevTools(window) {
  if (!window.webContents.isDevToolsOpened()) {
    const opened = new Promise((resolve) => window.webContents.once("devtools-opened", resolve));
    window.webContents.openDevTools({ mode: "right", activate: false });
    await opened;
  }
  await delay(100);
}

async function setRendererWidth(window, targetWidth) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const currentWidth = await window.webContents.executeJavaScript("window.innerWidth");
    if (Math.abs(currentWidth - targetWidth) <= 1) return currentWidth;
    const [contentWidth, contentHeight] = window.getContentSize();
    window.setContentSize(Math.max(640, contentWidth + targetWidth - currentWidth), contentHeight);
    await delay(80);
  }
  return window.webContents.executeJavaScript("window.innerWidth");
}

function finish(result, exitCode) {
  if (completed) return;
  completed = true;
  clearTimeout(timeout);
  process.stdout.write(`${JSON.stringify({ ...result, diagnostics })}\n`);
  app.exit(exitCode);
}

const timeout = setTimeout(async () => {
  let renderer = null;
  if (targetWindow && !targetWindow.isDestroyed()) {
    try {
      renderer = await targetWindow.webContents.executeJavaScript(`({
        url: location.href,
        text: document.body.innerText.slice(0, 500)
      })`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push(`Could not inspect renderer: ${message}`);
    }
  }
  finish({
    ok: false,
    smoke: "electron-sidebar-layout",
    error: { message: "Timed out waiting for the renderer layout" },
    renderer,
  }, 1);
}, 35_000);

app.once("browser-window-created", (_event, window) => {
  targetWindow = window;
  window.setContentSize(1100, 705);
  window.webContents.on("did-fail-load", (_loadEvent, code, description, url) => {
    diagnostics.push(`did-fail-load ${code} ${description} ${url}`);
  });
  window.webContents.on("console-message", (_consoleEvent, details) => {
    const message = typeof details === "object" && details ? details.message : String(details);
    if (/error|failed/i.test(message)) diagnostics.push(message);
  });
  window.webContents.once("did-finish-load", async () => {
    try {
      await openDockedDevTools(window);
      const scenarios = [];
      for (const targetWidth of TARGET_WIDTHS) {
        const calibratedWidth = await setRendererWidth(window, targetWidth);
        await delay(120);
        const metrics = await window.webContents.executeJavaScript(`(async () => {
          const deadline = Date.now() + 10000;
          const readLayout = () => ({
            main: document.querySelector('.main-area'),
            editor: document.querySelector('.editor-column'),
            host: document.querySelector('.nexus-side-panel-host'),
            vault: document.querySelector('.nexus-vault-panel'),
            appToolbar: document.querySelector('.toolbar'),
            editorToolbar: document.querySelector('.editor-container > .nexus-toolbar'),
          });
          let layout = readLayout();
          while (
            (Object.values(layout).some((element) => !element) ||
              layout.host.querySelectorAll('[data-nexus-product-surface]').length !== 2) &&
            Date.now() < deadline
          ) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            layout = readLayout();
          }
          const { main, editor, host, vault, appToolbar, editorToolbar } = layout;
          if (!main || !editor || !host || !vault || !appToolbar || !editorToolbar ||
            host.querySelectorAll('[data-nexus-product-surface]').length !== 2) {
            throw new Error('Expected Electron layout surfaces were not mounted');
          }

          const round = (value) => Math.round(value * 100) / 100;
          const rect = (element) => {
            const value = element.getBoundingClientRect();
            return { left: round(value.left), width: round(value.width) };
          };
          const geometry = () => ({
            rootClientWidth: document.documentElement.clientWidth,
            bodyScrollHeight: document.body.scrollHeight,
            mainScrollWidth: main.scrollWidth,
            editor: rect(editor),
            host: rect(host),
            vault: rect(vault),
          });

          const frames = [];
          for (let index = 0; index < 12; index += 1) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            frames.push(JSON.stringify(geometry()));
          }

          const hoverButton = editorToolbar.querySelector(
            'button[aria-describedby^="nexus-toolbar-tooltip-"]',
          );
          if (!hoverButton) throw new Error('Expected a toolbar button with a custom tooltip');
          const beforeHover = JSON.stringify(geometry());
          hoverButton.dispatchEvent(new MouseEvent('mouseenter'));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const tooltip = document.querySelector('.nexus-toolbar-tooltip');
          const duringHover = JSON.stringify(geometry());
          const tooltipSnapshot = tooltip ? {
            position: getComputedStyle(tooltip).position,
            pointerEvents: getComputedStyle(tooltip).pointerEvents,
          } : null;
          hoverButton.dispatchEvent(new MouseEvent('mouseleave'));
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const afterHover = JSON.stringify(geometry());

          return {
            hostMode: window.nexusHost?.mode ?? null,
            viewportWidth: innerWidth,
            mainClientWidth: main.clientWidth,
            mainScrollWidth: main.scrollWidth,
            editorWidth: rect(editor).width,
            hostWidth: rect(host).width,
            vaultWidth: rect(vault).width,
            hostPosition: getComputedStyle(host).position,
            vaultPosition: getComputedStyle(vault).position,
            appToolbarWrap: getComputedStyle(appToolbar).flexWrap,
            editorToolbarWrap: getComputedStyle(editorToolbar).flexWrap,
            productSurfaceCount: host.querySelectorAll('[data-nexus-product-surface]').length,
            frameSignatureCount: new Set(frames).size,
            hover: {
              stable: beforeHover === duringHover && beforeHover === afterHover,
              tooltipPosition: tooltipSnapshot?.position ?? null,
              tooltipPointerEvents: tooltipSnapshot?.pointerEvents ?? null,
              removed: !document.querySelector('.nexus-toolbar-tooltip'),
            },
          };
        })()`);
        scenarios.push({ targetWidth, calibratedWidth, ...metrics });
      }

      const failures = [];
      for (const scenario of scenarios) {
        const label = `${scenario.targetWidth}px`;
        if (Math.abs(scenario.calibratedWidth - scenario.targetWidth) > 1) {
          failures.push(`${label}: width calibration failed`);
        }
        if (scenario.hostMode !== "legacy") failures.push(`${label}: legacy host was not active`);
        if (scenario.mainScrollWidth !== scenario.mainClientWidth) {
          failures.push(`${label}: horizontal overflow`);
        }
        if (scenario.frameSignatureCount !== 1) failures.push(`${label}: layout changed between frames`);
        if (scenario.hostPosition !== "static" || scenario.vaultPosition !== "static") {
          failures.push(`${label}: panel left normal flow`);
        }
        if (scenario.productSurfaceCount !== 2) failures.push(`${label}: product panels were not co-located`);
        if (!scenario.hover.stable) failures.push(`${label}: tooltip hover changed layout geometry`);
        if (scenario.hover.tooltipPosition !== "fixed" || scenario.hover.tooltipPointerEvents !== "none") {
          failures.push(`${label}: tooltip is not a non-interactive overlay`);
        }
        if (!scenario.hover.removed) failures.push(`${label}: tooltip remained after mouseleave`);
      }

      const primary = scenarios.at(-1);
      if (!primary || Math.abs(primary.viewportWidth - 578) > 1) {
        failures.push("final narrow viewport was not exercised");
      } else {
        if (primary.editorWidth < 220) failures.push("final editor width is too narrow");
        if (primary.hostWidth > 220) failures.push("final reference panel is too wide");
        if (primary.vaultWidth > 180) failures.push("final vault panel is too wide");
        if (primary.appToolbarWrap !== "wrap" || primary.editorToolbarWrap !== "wrap") {
          failures.push("toolbars do not wrap at the final narrow viewport");
        }
      }

      finish({
        ok: failures.length === 0,
        smoke: "electron-sidebar-layout",
        devToolsDocked: true,
        failures,
        scenarios,
      }, failures.length === 0 ? 0 : 1);
    } catch (error) {
      finish({
        ok: false,
        smoke: "electron-sidebar-layout",
        error: { message: error instanceof Error ? error.message : String(error) },
      }, 1);
    }
  });
});

require(path.resolve(__dirname, "../dist-electron/main.js"));
