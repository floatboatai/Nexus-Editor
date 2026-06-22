"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/preload.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");
var vaultBridge = {
  pick() {
    return import_electron.ipcRenderer.invoke("vault:pick");
  },
  list(vaultPath) {
    return import_electron.ipcRenderer.invoke("vault:list", vaultPath);
  },
  read(filePath) {
    return import_electron.ipcRenderer.invoke("vault:read", filePath);
  },
  readAll() {
    return import_electron.ipcRenderer.invoke("vault:read-all");
  },
  write(filePath, content) {
    return import_electron.ipcRenderer.invoke("vault:write", filePath, content);
  },
  createFile(parentDir, name) {
    return import_electron.ipcRenderer.invoke("vault:create-file", parentDir, name);
  },
  createFolder(parentDir, name) {
    return import_electron.ipcRenderer.invoke("vault:create-folder", parentDir, name);
  },
  rename(oldPath, newName) {
    return import_electron.ipcRenderer.invoke("vault:rename", oldPath, newName);
  },
  delete(targetPath) {
    return import_electron.ipcRenderer.invoke("vault:delete", targetPath);
  },
  getLast() {
    return import_electron.ipcRenderer.invoke("vault:get-last");
  },
  setLast(vaultPath) {
    return import_electron.ipcRenderer.invoke("vault:set-last", vaultPath);
  },
  onChanged(cb) {
    const listener = (_event, payload) => cb(payload);
    import_electron.ipcRenderer.on("vault:changed", listener);
    return () => {
      import_electron.ipcRenderer.off("vault:changed", listener);
    };
  }
};
var bridge = {
  openFile() {
    return import_electron.ipcRenderer.invoke("demo:open-file");
  },
  saveFile(path, content) {
    return import_electron.ipcRenderer.invoke("demo:save-file", path, content);
  },
  saveFileAs(content) {
    return import_electron.ipcRenderer.invoke("demo:save-file-as", content);
  },
  vault: vaultBridge,
  llmWiki: {
    saveSource(input) {
      return import_electron.ipcRenderer.invoke("llm-wiki:save-source", input);
    },
    getStatus() {
      return import_electron.ipcRenderer.invoke("llm-wiki:get-status");
    },
    getDocStatuses() {
      return import_electron.ipcRenderer.invoke("llm-wiki:get-doc-statuses");
    },
    submitDoc(input) {
      return import_electron.ipcRenderer.invoke("llm-wiki:submit-doc", input);
    },
    submitAllDirty() {
      return import_electron.ipcRenderer.invoke("llm-wiki:submit-all-dirty");
    },
    retryFailed() {
      return import_electron.ipcRenderer.invoke("llm-wiki:retry-failed");
    },
    getSubmitMode() {
      return import_electron.ipcRenderer.invoke("llm-wiki:get-submit-mode");
    },
    setSubmitMode(mode) {
      return import_electron.ipcRenderer.invoke("llm-wiki:set-submit-mode", mode);
    },
    getConfigStatus() {
      return import_electron.ipcRenderer.invoke("llm-wiki:get-config-status");
    },
    saveConfig(input) {
      return import_electron.ipcRenderer.invoke("llm-wiki:save-config", input);
    },
    ask(input) {
      return import_electron.ipcRenderer.invoke("llm-wiki:ask", input);
    },
    openSchema(input) {
      return import_electron.ipcRenderer.invoke("llm-wiki:open-schema", input);
    },
    onStatus(cb) {
      const listener = (_event, status) => cb(status);
      import_electron.ipcRenderer.on("llm-wiki:status", listener);
      return () => {
        import_electron.ipcRenderer.off("llm-wiki:status", listener);
      };
    },
    onDocStatus(cb) {
      const listener = (_event, payload) => cb(payload);
      import_electron.ipcRenderer.on("llm-wiki:doc-status", listener);
      return () => {
        import_electron.ipcRenderer.off("llm-wiki:doc-status", listener);
      };
    }
  }
};
import_electron.contextBridge.exposeInMainWorld("nexusDemo", bridge);
