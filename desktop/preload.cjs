"use strict";

/**
 * The settings window's only door to the app: read the settings (never a key's
 * value), save them. Nothing else — no Node, no file system.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lifeosDesktop", {
  get: () => ipcRenderer.invoke("settings:get"),
  save: (update) => ipcRenderer.invoke("settings:save", update),
});
