import type { EditorAPI, NexusTheme } from '@floatboat/nexus-webcomponent';
import { lightTheme, darkTheme } from '@floatboat/nexus-webcomponent';
import './SettingsPanel.css';

export interface SettingsPanel {
  element: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export function createSettingsPanel(editor: EditorAPI): SettingsPanel {
  const backdrop = document.createElement("div");
  backdrop.className = "nexus-settings-backdrop";
  backdrop.style.display = "none";

  const dialog = document.createElement("div");
  dialog.className = "nexus-settings-dialog";
  backdrop.appendChild(dialog);

  const header = document.createElement("div");
  header.className = "nexus-settings-header";
  header.textContent = "Settings";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "nexus-settings-close";
  closeBtn.textContent = "\u00D7";
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const body = document.createElement("div");
  body.className = "nexus-settings-body";
  dialog.appendChild(body);

  interface SettingEntry {
    type: "toggle" | "select" | "slider" | "text";
    title: string;
    description: string;
    key: string;
    options?: string[];
    min?: number;
    max?: number;
    defaultValue?: string | boolean | number;
  }

  const settings: SettingEntry[] = [
    {
      type: "toggle",
      title: "Line Numbers",
      description: "Show line numbers in the editor",
      key: "lineNumbers",
      defaultValue: true,
    },
    {
      type: "toggle",
      title: "Spell Check",
      description: "Enable spell checking",
      key: "spellCheck",
      defaultValue: false,
    },
    {
      type: "toggle",
      title: "Typewriter Mode",
      description: "Keep the cursor centered vertically",
      key: "typewriter",
      defaultValue: false,
    },
    {
      type: "select",
      title: "Theme",
      description: "Editor color theme",
      key: "theme",
      options: ["Light", "Dark"],
      defaultValue: "Light",
    },
    {
      type: "slider",
      title: "Font Size",
      description: "Editor font size",
      key: "fontSize",
      min: 10,
      max: 24,
      defaultValue: 14,
    },
  ];

  function createToggle(setting: SettingEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "nexus-settings-row";

    const label = document.createElement("div");
    label.className = "nexus-settings-label";

    const title = document.createElement("div");
    title.className = "nexus-settings-label-title";
    title.textContent = setting.title;
    label.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "nexus-settings-label-desc";
    desc.textContent = setting.description;
    label.appendChild(desc);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nexus-settings-toggle";

    const savedValue = localStorage.getItem(setting.key);
    const isEnabled = savedValue ? savedValue === "true" : (setting.defaultValue === true);
    
    toggle.classList.add(isEnabled ? "enabled" : "disabled");
    
    toggle.addEventListener("click", () => {
      const newValue = !isEnabled;
      localStorage.setItem(setting.key, String(newValue));
      toggle.classList.toggle("enabled", newValue);
      toggle.classList.toggle("disabled", !newValue);
    });

    row.appendChild(label);
    row.appendChild(toggle);
    return row;
  }

  function createSelect(setting: SettingEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "nexus-settings-row";

    const label = document.createElement("div");
    label.className = "nexus-settings-label";

    const title = document.createElement("div");
    title.className = "nexus-settings-label-title";
    title.textContent = setting.title;
    label.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "nexus-settings-label-desc";
    desc.textContent = setting.description;
    label.appendChild(desc);

    const select = document.createElement("select");
    select.className = "nexus-settings-select";

    setting.options?.forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt;
      option.textContent = opt;
      select.appendChild(option);
    });

    const savedValue = localStorage.getItem(setting.key);
    select.value = savedValue || (setting.defaultValue as string);

    select.addEventListener("change", () => {
      localStorage.setItem(setting.key, select.value);
    });

    row.appendChild(label);
    row.appendChild(select);
    return row;
  }

  function createSlider(setting: SettingEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "nexus-settings-row";

    const label = document.createElement("div");
    label.className = "nexus-settings-label";

    const title = document.createElement("div");
    title.className = "nexus-settings-label-title";
    title.textContent = setting.title;
    label.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "nexus-settings-label-desc";
    desc.textContent = setting.description;
    label.appendChild(desc);

    const numberInput = document.createElement("div");
    numberInput.className = "nexus-settings-number-input";

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(setting.min);
    slider.max = String(setting.max);

    const savedValue = localStorage.getItem(setting.key);
    const value = savedValue ? parseInt(savedValue) : (setting.defaultValue as number);
    slider.value = String(value);

    const display = document.createElement("span");
    display.textContent = `${value}px`;

    slider.addEventListener("input", () => {
      const newValue = parseInt(slider.value);
      display.textContent = `${newValue}px`;
      localStorage.setItem(setting.key, String(newValue));
      
      const savedTheme = localStorage.getItem("theme");
      const baseTheme: NexusTheme = savedTheme === "Dark" ? { ...darkTheme } : { ...lightTheme };
      baseTheme.fontSize = newValue;
      editor.setTheme(baseTheme);
    });

    numberInput.appendChild(slider);
    numberInput.appendChild(display);

    row.appendChild(label);
    row.appendChild(numberInput);
    return row;
  }

  const sectionTitle = document.createElement("div");
  sectionTitle.className = "nexus-settings-section-title";
  sectionTitle.textContent = "Editor";
  body.appendChild(sectionTitle);

  for (const setting of settings) {
    switch (setting.type) {
      case "toggle":
        body.appendChild(createToggle(setting));
        break;
      case "select":
        body.appendChild(createSelect(setting));
        break;
      case "slider":
        body.appendChild(createSlider(setting));
        break;
    }
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  closeBtn.addEventListener("click", close);

  let openState = false;

  function open() {
    openState = true;
    backdrop.style.display = "";
    backdrop.style.opacity = "1";
    document.body.style.overflow = "hidden";
  }

  function close() {
    openState = false;
    backdrop.style.display = "none";
    document.body.style.overflow = "";
  }

  return {
    element: backdrop,
    open,
    close,
    isOpen: () => openState,
    destroy() {
      close();
      backdrop.remove();
    },
  };
}