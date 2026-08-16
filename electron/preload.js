const { contextBridge, ipcRenderer } = require("electron");

// Only these specific, named functions are exposed to the React UI.
// The renderer can never reach raw Node/Electron APIs directly — this
// is what keeps a webpage-style UI safe to run with full filesystem
// and network access under the hood.
contextBridge.exposeInMainWorld("releaseRadar", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", { key, value }),
  fetchChanges: (params) => ipcRenderer.invoke("release-radar:fetch-changes", params),
  publish: (params) => ipcRenderer.invoke("release-radar:publish", params),
  listCommits: (params) => ipcRenderer.invoke("release-radar:list-commits", params),
  getRepoDefaults: (params) => ipcRenderer.invoke("release-radar:repo-defaults", params),

  // Progress updates pushed from the main process (GitHub fetch / AI classify
  // / rate-limit retry). Returns an unsubscribe function.
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("release-radar:status", listener);
    return () => ipcRenderer.removeListener("release-radar:status", listener);
  }
});
