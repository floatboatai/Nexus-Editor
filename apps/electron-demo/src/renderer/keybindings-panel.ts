import type { EditorAPI, KeybindingEntry, KeybindingOverride } from "@floatboat/nexus-core";

export interface KeybindingsPanel {
  element: HTMLElement;
  destroy(): void;
}

const PANEL_STYLES = `
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--nexus-border, #eee);
  background: var(--nexus-bg, #fff);
  overflow-y: auto;
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  display: flex;
  flex-direction: column;
`;

const HEADER_STYLES = `
  padding: 10px 14px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--nexus-text-muted, #888);
  border-bottom: 1px solid var(--nexus-border, #eee);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const RESET_ALL_BTN_STYLES = `
  border: 1px solid var(--nexus-border, #ddd);
  background: var(--nexus-bg, #fff);
  color: var(--nexus-text, #24292e);
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  text-transform: none;
  letter-spacing: normal;
  font-weight: 500;
`;

const LIST_STYLES = `
  flex: 1;
  overflow-y: auto;
  padding: 0;
`;

const ROW_STYLES = `
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px 12px;
  align-items: center;
  padding: 8px 14px;
  border-bottom: 1px solid var(--nexus-border-soft, #f2f2f2);
`;

const ROW_META_STYLES = `
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const LABEL_STYLES = `
  color: var(--nexus-text, #24292e);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ID_STYLES = `
  color: var(--nexus-text-faint, #999);
  font-size: 11px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const KEY_STYLES = `
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--nexus-bg-muted, #f0f0f0);
  color: var(--nexus-text, #24292e);
  border: 1px solid transparent;
`;

const KEY_CAPTURING_STYLES = KEY_STYLES + `
  background: var(--nexus-accent-soft, #e0f0ff);
  border-color: var(--nexus-accent, #4a9eff);
  color: var(--nexus-accent, #2464cc);
`;

const KEY_UNBOUND_STYLES = KEY_STYLES + `
  color: var(--nexus-text-faint, #bbb);
  font-style: italic;
`;

const KEY_CONFLICT_STYLES = KEY_STYLES + `
  color: #b02a2a;
  border-color: #f0a0a0;
  background: #fdecec;
`;

const OVERRIDE_INDICATOR_STYLES = `
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--nexus-accent, #4a9eff);
  margin-right: 4px;
  vertical-align: middle;
`;

const ACTION_ROW_STYLES = `
  display: flex;
  gap: 4px;
`;

const ACTION_BTN_STYLES = `
  border: 1px solid var(--nexus-border, #ddd);
  background: var(--nexus-bg, #fff);
  color: var(--nexus-text, #24292e);
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: background 0.1s;
`;

const EMPTY_STYLES = `
  padding: 16px 14px;
  color: var(--nexus-text-faint, #bbb);
  font-size: 12px;
  font-style: italic;
`;

/**
 * Panel that lists every plugin-declared keybinding and lets the user rebind
 * or clear each one via `EditorAPI.setUserKeybindings()`. State (the current
 * override snapshot) is held locally — the demo doesn't persist it, matching
 * the core's "hosts own persistence" contract.
 */
export function createKeybindingsPanel(editor: EditorAPI): KeybindingsPanel {
  const panel = document.createElement("div");
  panel.className = "nexus-keybindings-panel";
  panel.style.cssText = PANEL_STYLES;

  const header = document.createElement("div");
  header.style.cssText = HEADER_STYLES;
  const title = document.createElement("span");
  title.textContent = "Keybindings";
  const resetAllBtn = document.createElement("button");
  resetAllBtn.type = "button";
  resetAllBtn.textContent = "Reset all";
  resetAllBtn.style.cssText = RESET_ALL_BTN_STYLES;
  header.append(title, resetAllBtn);

  const list = document.createElement("div");
  list.style.cssText = LIST_STYLES;

  panel.append(header, list);

  // Local snapshot mirror of the overrides currently applied to the editor.
  const overrides = new Map<string, string | null>();
  // While one row is capturing a key, other rows should not fire.
  let capturingId: string | null = null;
  // Detach fn for the current capture's global keydown listener.
  let releaseCapture: (() => void) | null = null;

  function applyOverrides(): void {
    const snapshot: KeybindingOverride[] = [];
    for (const [id, key] of overrides) snapshot.push({ id, key });
    editor.setUserKeybindings(snapshot);
  }

  function formatKey(ev: KeyboardEvent): string | null {
    // Ignore pure modifier presses — the user hasn't finished the combo yet.
    if (ev.key === "Control" || ev.key === "Shift" || ev.key === "Alt" || ev.key === "Meta") {
      return null;
    }
    const parts: string[] = [];
    // Cross-platform token — CM6 resolves Mod to Cmd on macOS, Ctrl elsewhere.
    if (ev.ctrlKey || ev.metaKey) parts.push("Mod");
    if (ev.altKey) parts.push("Alt");
    if (ev.shiftKey) parts.push("Shift");
    // Normalize letters to lowercase (CM6 convention: `Mod-k`, not `Mod-K`).
    // Preserve other keys as-is (F1, ArrowUp, Escape, ...).
    const raw = ev.key;
    const finalKey = /^[a-zA-Z]$/.test(raw) ? raw.toLowerCase() : raw;
    parts.push(finalKey);
    return parts.join("-");
  }

  function beginCapture(id: string, keyEl: HTMLElement, defaultLabel: string): void {
    if (capturingId === id) return;
    releaseCapture?.();
    capturingId = id;
    keyEl.textContent = "Press a key…";
    keyEl.style.cssText = KEY_CAPTURING_STYLES;

    const onKeyDown = (ev: KeyboardEvent) => {
      // Escape cancels without applying.
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        cleanup();
        keyEl.textContent = defaultLabel;
        keyEl.style.cssText = KEY_STYLES;
        return;
      }
      const key = formatKey(ev);
      if (key === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      overrides.set(id, key);
      applyOverrides();
      cleanup();
      // render() will be triggered by the keybindingsChange event handler.
    };
    function cleanup() {
      window.removeEventListener("keydown", onKeyDown, true);
      capturingId = null;
      releaseCapture = null;
    }
    releaseCapture = cleanup;
    // Capture-phase so we win over CodeMirror's own keydown handler.
    window.addEventListener("keydown", onKeyDown, true);
  }

  function render(entries: KeybindingEntry[]): void {
    // Cancel any in-flight capture so its state doesn't attach to a stale row.
    releaseCapture?.();
    list.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = EMPTY_STYLES;
      empty.textContent = "No plugin bindings registered.";
      list.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement("div");
      row.style.cssText = ROW_STYLES;

      const meta = document.createElement("div");
      meta.style.cssText = ROW_META_STYLES;
      const label = document.createElement("div");
      label.style.cssText = LABEL_STYLES;
      const overridden = entry.key !== entry.defaultKey;
      if (overridden) {
        const dot = document.createElement("span");
        dot.style.cssText = OVERRIDE_INDICATOR_STYLES;
        dot.title = "Overridden";
        label.appendChild(dot);
      }
      label.appendChild(
        document.createTextNode(entry.label ?? entry.id.split(":").pop() ?? entry.id)
      );
      if (overridden) {
        label.appendChild(document.createTextNode(` (default: ${entry.defaultKey})`));
      }
      const idLine = document.createElement("div");
      idLine.style.cssText = ID_STYLES;
      idLine.textContent = entry.id;
      idLine.title = entry.id;
      meta.append(label, idLine);

      const actions = document.createElement("div");
      actions.style.cssText = ACTION_ROW_STYLES;

      const keyEl = document.createElement("span");
      const isConflict = entry.conflicts.length > 0;
      if (entry.key === null) {
        keyEl.textContent = "unbound";
        keyEl.style.cssText = KEY_UNBOUND_STYLES;
      } else if (isConflict) {
        keyEl.textContent = entry.key;
        keyEl.style.cssText = KEY_CONFLICT_STYLES;
        keyEl.title = "Collides with: " + entry.conflicts.join(", ");
      } else {
        keyEl.textContent = entry.key;
        keyEl.style.cssText = KEY_STYLES;
      }
      keyEl.style.cursor = "pointer";
      const currentLabel = keyEl.textContent ?? "";
      keyEl.addEventListener("click", () => beginCapture(entry.id, keyEl, currentLabel));

      const rebindBtn = document.createElement("button");
      rebindBtn.type = "button";
      rebindBtn.textContent = "Rebind";
      rebindBtn.style.cssText = ACTION_BTN_STYLES;
      rebindBtn.addEventListener("click", () => beginCapture(entry.id, keyEl, currentLabel));

      const unbindBtn = document.createElement("button");
      unbindBtn.type = "button";
      unbindBtn.textContent = "Unbind";
      unbindBtn.style.cssText = ACTION_BTN_STYLES;
      unbindBtn.addEventListener("click", () => {
        overrides.set(entry.id, null);
        applyOverrides();
      });

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.textContent = "Reset";
      resetBtn.style.cssText = ACTION_BTN_STYLES;
      resetBtn.disabled = !overrides.has(entry.id);
      resetBtn.style.opacity = overrides.has(entry.id) ? "1" : "0.4";
      resetBtn.addEventListener("click", () => {
        overrides.delete(entry.id);
        applyOverrides();
      });

      actions.append(keyEl, rebindBtn, unbindBtn, resetBtn);
      row.append(meta, actions);
      list.appendChild(row);
    }
  }

  const handleChange = (entries: KeybindingEntry[]) => render(entries);
  editor.on("keybindingsChange", handleChange);
  // Initial render — hydration event will fire on the next microtask, but we
  // also seed synchronously in case the panel is created after hydration.
  render(editor.getKeybindings());

  resetAllBtn.addEventListener("click", () => {
    overrides.clear();
    applyOverrides();
  });

  return {
    element: panel,
    destroy() {
      releaseCapture?.();
      editor.off("keybindingsChange", handleChange);
      panel.remove();
    },
  };
}
