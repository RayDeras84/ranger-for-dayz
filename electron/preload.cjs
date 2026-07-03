const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dayz", {
  getAppInfo: () => ipcRenderer.invoke("app:info"),
  openExternal: (url) => ipcRenderer.invoke("app:open-external", url),
  checkForUpdates: () => ipcRenderer.invoke("app:check-updates"),
  installUpdate: () => ipcRenderer.invoke("app:install-update"),
  onUpdateStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },
  getState: () => ipcRenderer.invoke("state:get"),
  saveState: (patch) => ipcRenderer.invoke("state:save", patch),
  detectPaths: () => ipcRenderer.invoke("paths:detect"),
  scanMods: (overrides) => ipcRenderer.invoke("mods:scan", overrides),
  deleteMod: (payload) => ipcRenderer.invoke("mods:delete", payload),
  deleteMods: (payload) => ipcRenderer.invoke("mods:delete-many", payload),
  listServers: (options) => ipcRenderer.invoke("servers:list", options),
  discoverServers: (options) => ipcRenderer.invoke("servers:discover", options),
  refreshServer: (server) => ipcRenderer.invoke("servers:refresh-one", server),
  onServerDiscovery: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("servers:discovery", listener);
    return () => ipcRenderer.removeListener("servers:discovery", listener);
  },
  openSteam: (url) => ipcRenderer.invoke("steam:open", url),
  probeSteam: () => ipcRenderer.invoke("steam:probe"),
  syncWorkshop: (payload) => ipcRenderer.invoke("steam:sync-workshop", payload),
  stopWorkshopSync: () => ipcRenderer.invoke("steam:stop-workshop-sync"),
  onSyncProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("steam:sync-progress", listener);
    return () => ipcRenderer.removeListener("steam:sync-progress", listener);
  },
  launch: (payload) => ipcRenderer.invoke("dayz:launch", payload)
});
