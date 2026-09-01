const { contextBridge, ipcRenderer } = require("electron");

// Only these specific, named functions are exposed to the React UI.
// The renderer can never reach raw Node/Electron APIs directly — this
// is what keeps a webpage-style UI safe to run with full filesystem
// and network access under the hood.
contextBridge.exposeInMainWorld("releaseRadar", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", { key, value }),
  // Opens the pre-filled GitHub token form in the user's default browser.
  // Takes no arguments on purpose: the URL is built in the main process so the
  // renderer can never talk shell.openExternal into opening something else.
  openTokenCreationUrl: () => ipcRenderer.invoke("settings:open-token-creation-url"),
  fetchChanges: (params) => ipcRenderer.invoke("release-radar:fetch-changes", params),
  publish: (params) => ipcRenderer.invoke("release-radar:publish", params),
  listCommits: (params) => ipcRenderer.invoke("release-radar:list-commits", params),
  getRepoDefaults: (params) => ipcRenderer.invoke("release-radar:repo-defaults", params),

  exportNotes: (params) => ipcRenderer.invoke("release-radar:export", params),
  exportSave: (params) => ipcRenderer.invoke("release-radar:export-save", params),

  getHistory: () => ipcRenderer.invoke("release-radar:history-list"),
  deleteHistoryEntry: (id) => ipcRenderer.invoke("release-radar:history-delete", { id }),
  clearHistory: () => ipcRenderer.invoke("release-radar:history-clear"),

  // Window chrome. The app draws its own title bar because the native one
  // cannot be themed, so these stand in for what the OS frame used to do.
  // `platform` is read here rather than sniffed from the user agent: the
  // renderer needs it to decide whether to draw buttons at all (macOS keeps
  // its native traffic lights).
  windowControls: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => ipcRenderer.invoke("window:toggle-maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized"),
    // Returns an unsubscribe function, matching onStatus below. The raw
    // IpcRendererEvent is not forwarded — the renderer only needs the boolean.
    onMaximizeChange: (callback) => {
      const listener = (_event, isMaximized) => callback(isMaximized);
      ipcRenderer.on("window:maximize-changed", listener);
      return () => ipcRenderer.removeListener("window:maximize-changed", listener);
    },
    platform: process.platform
  },

  // Progress updates pushed from the main process (GitHub fetch / AI classify
  // / rate-limit retry). Returns an unsubscribe function.
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("release-radar:status", listener);
    return () => ipcRenderer.removeListener("release-radar:status", listener);
  }
});
