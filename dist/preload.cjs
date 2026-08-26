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

// src/main/preload.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");
var api = {
  getDocumentCount: () => import_electron.ipcRenderer.invoke("app:getDocumentCount"),
  rescan: () => import_electron.ipcRenderer.invoke("app:rescan"),
  search: (query) => import_electron.ipcRenderer.invoke("app:search", query),
  openFile: (filePath) => import_electron.ipcRenderer.invoke("app:openFile", filePath),
  showInFolder: (filePath) => import_electron.ipcRenderer.invoke("app:showInFolder", filePath),
  onProgress: (callback) => {
    const listener = (_event, data) => callback(data);
    import_electron.ipcRenderer.on("index:progress", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("index:progress", listener);
    };
  },
  getAboutInfo: () => import_electron.ipcRenderer.invoke("app:getAboutInfo"),
  openExternal: (url) => import_electron.ipcRenderer.invoke("app:openExternal", url),
  sendFeedback: () => import_electron.ipcRenderer.invoke("app:sendFeedback"),
  copyToClipboard: (text) => import_electron.ipcRenderer.invoke("app:copyToClipboard", text),
  getTheme: () => import_electron.ipcRenderer.invoke("app:getTheme"),
  setTheme: (theme) => import_electron.ipcRenderer.invoke("app:setTheme", theme),
  onThemeChanged: (callback) => {
    const listener = (_event, theme) => callback(theme);
    import_electron.ipcRenderer.on("app:themeChanged", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("app:themeChanged", listener);
    };
  },
  checkForUpdates: () => import_electron.ipcRenderer.invoke("app:checkForUpdates"),
  onUpdateAvailable: (callback) => {
    const listener = (_event, info) => callback(info);
    import_electron.ipcRenderer.on("app:updateAvailable", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("app:updateAvailable", listener);
    };
  },
  onShowAboutDialog: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("app:showAboutDialog", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("app:showAboutDialog", listener);
    };
  },
  onShowSearchAreasDialog: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("app:showSearchAreasDialog", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("app:showSearchAreasDialog", listener);
    };
  },
  onTriggerCheckUpdates: (callback) => {
    const listener = () => callback();
    import_electron.ipcRenderer.on("app:triggerCheckUpdates", listener);
    return () => {
      import_electron.ipcRenderer.removeListener("app:triggerCheckUpdates", listener);
    };
  },
  getSearchScopeMode: () => import_electron.ipcRenderer.invoke("app:getSearchScopeMode"),
  setSearchScopeMode: (mode) => import_electron.ipcRenderer.invoke("app:setSearchScopeMode", mode),
  getSearchAreas: () => import_electron.ipcRenderer.invoke("app:getSearchAreas"),
  addSearchArea: (folderPath, type) => import_electron.ipcRenderer.invoke("app:addSearchArea", folderPath, type),
  removeSearchArea: (folderPath) => import_electron.ipcRenderer.invoke("app:removeSearchArea", folderPath),
  selectFolder: () => import_electron.ipcRenderer.invoke("app:selectFolder")
};
import_electron.contextBridge.exposeInMainWorld("api", api);
