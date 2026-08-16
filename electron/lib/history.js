const Store = require("electron-store");

// Deliberately a separate store from store.js: that one wraps every value in
// safeStorage encryption because it holds API keys. Changelogs aren't secret,
// and encrypting them would only make the history file unreadable and slower
// to load for no benefit.
const store = new Store({ name: "release-radar-history" });

// Keeps the file from growing without bound over months of use. Oldest
// entries fall off the end.
const MAX_ENTRIES = 200;

function listHistory() {
  const entries = store.get("entries");
  return Array.isArray(entries) ? entries : [];
}

function addHistoryEntry({ repo, range, markdown, detailed }) {
  if (!markdown) return null;

  const entry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    repo,
    range,
    markdown,
    detailed: Boolean(detailed),
    createdAt: new Date().toISOString()
  };

  store.set("entries", [entry, ...listHistory()].slice(0, MAX_ENTRIES));
  return entry;
}

function deleteHistoryEntry(id) {
  store.set("entries", listHistory().filter((e) => e.id !== id));
}

function clearHistory() {
  store.set("entries", []);
}

module.exports = { listHistory, addHistoryEntry, deleteHistoryEntry, clearHistory, MAX_ENTRIES };
