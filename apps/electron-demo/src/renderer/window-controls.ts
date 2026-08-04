import { iconEl } from "./icons";

export interface WindowControls {
  element: HTMLElement;
  destroy(): void;
}

/**
 * Windows / Linux frameless window buttons (min / max-restore / close).
 * macOS uses native traffic lights via titleBarStyle: hiddenInset.
 */
export function createWindowControls(): WindowControls {
  const winApi = window.nexusDemo.window;
  const root = document.createElement("div");
  root.className = "nx-window-controls nx-no-drag";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Window controls");

  const minBtn = document.createElement("button");
  minBtn.type = "button";
  minBtn.className = "nx-window-controls__btn nx-window-controls__btn--min";
  minBtn.title = "Minimize";
  minBtn.setAttribute("aria-label", "Minimize");
  minBtn.appendChild(iconEl("winMinimize"));

  const maxBtn = document.createElement("button");
  maxBtn.type = "button";
  maxBtn.className = "nx-window-controls__btn nx-window-controls__btn--max";
  maxBtn.title = "Maximize";
  maxBtn.setAttribute("aria-label", "Maximize");
  maxBtn.appendChild(iconEl("winMaximize"));

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "nx-window-controls__btn nx-window-controls__btn--close";
  closeBtn.title = "Close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.appendChild(iconEl("winClose"));

  root.append(minBtn, maxBtn, closeBtn);

  function setMaximized(maximized: boolean): void {
    maxBtn.replaceChildren(iconEl(maximized ? "winRestore" : "winMaximize"));
    maxBtn.title = maximized ? "Restore" : "Maximize";
    maxBtn.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
    document.body.classList.toggle("is-window-maximized", maximized);
  }

  minBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void winApi.minimize();
  });
  maxBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void winApi.toggleMaximize().then(setMaximized);
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    void winApi.close();
  });

  void winApi.isMaximized().then(setMaximized);
  const unsubMax = winApi.onMaximizedChange(setMaximized);
  const unsubFs = winApi.onFullscreenChange((fs) => {
    document.body.classList.toggle("is-window-fullscreen", fs);
  });

  return {
    element: root,
    destroy() {
      unsubMax();
      unsubFs();
      root.remove();
    },
  };
}

/** Apply platform class + optional custom window controls to the chrome bar. */
export function installWindowChrome(toolbar: HTMLElement): () => void {
  const winApi = window.nexusDemo?.window;
  // Browser/unit tests may not inject the window bridge.
  if (!winApi) {
    document.body.classList.add("platform-unknown");
    return () => undefined;
  }

  const platform = winApi.platform || "unknown";
  document.body.classList.add(`platform-${platform}`);
  document.documentElement.dataset.platform = platform;

  const cleanups: Array<() => void> = [];

  if (winApi.usesCustomWindowControls) {
    document.body.classList.add("has-custom-window-controls");
    const controls = createWindowControls();
    toolbar.appendChild(controls.element);
    cleanups.push(() => controls.destroy());
  } else {
    document.body.classList.add("has-native-traffic-lights");
  }

  // Double-click the drag region (title) to toggle maximize — Windows/Linux
  // convention; also useful on macOS for parity with native titlebars.
  const title = toolbar.querySelector(".nx-chrome__title");
  if (title) {
    const onDblClick = (e: Event) => {
      e.preventDefault();
      void winApi.toggleMaximize();
    };
    title.addEventListener("dblclick", onDblClick);
    cleanups.push(() => title.removeEventListener("dblclick", onDblClick));
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
