import React, { useEffect, useState } from "react";

function formatWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString();
}

// Ranges are often full SHAs, which are unreadable at full length.
function shortenRange(range) {
  return (range || "")
    .split("...")
    .map((ref) => (/^[0-9a-f]{40}$/i.test(ref) ? ref.slice(0, 7) : ref))
    .join(" → ");
}

export default function HistoryList({ onRegenerate, onError }) {
  const [entries, setEntries] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    window.releaseRadar
      .getHistory()
      .then(setEntries)
      .catch((err) => onError?.(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete(id) {
    try {
      setEntries(await window.releaseRadar.deleteHistoryEntry(id));
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      onError?.(err.message);
    }
  }

  async function handleClearAll() {
    try {
      setEntries(await window.releaseRadar.clearHistory());
      setExpandedId(null);
    } catch (err) {
      onError?.(err.message);
    }
  }

  if (loading) return <p>Loading history...</p>;

  if (entries.length === 0) {
    return (
      <p style={{ color: "#666" }}>
        No saved changelogs yet. Every changelog you generate is saved here automatically.
      </p>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "#666" }}>
          {entries.length} saved changelog{entries.length === 1 ? "" : "s"}, newest first
        </span>
        <button onClick={handleClearAll}>Clear all</button>
      </div>

      {entries.map((entry) => {
        const isOpen = expandedId === entry.id;
        return (
          <div key={entry.id} style={{ border: "1px solid #ddd", borderRadius: 4, marginBottom: 8 }}>
            <div
              onClick={() => setExpandedId(isOpen ? null : entry.id)}
              style={{ padding: "10px 12px", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 12 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14 }}>
                  <strong>{entry.repo}</strong>{" "}
                  <span style={{ color: "#666" }}>{shortenRange(entry.range)}</span>
                </div>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {formatWhen(entry.createdAt)}
                  {entry.detailed && " · detailed analysis"}
                </div>
              </div>
              <span style={{ color: "#888", fontSize: 12, whiteSpace: "nowrap" }}>
                {isOpen ? "▲ hide" : "▼ view"}
              </span>
            </div>

            {isOpen && (
              <div style={{ borderTop: "1px solid #eee", padding: 12 }}>
                <pre style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 12, margin: 0, fontSize: 12 }}>
                  {entry.markdown}
                </pre>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={() => navigator.clipboard?.writeText(entry.markdown)}>Copy markdown</button>
                  <button onClick={() => onRegenerate?.(entry)}>Regenerate</button>
                  <button onClick={() => handleDelete(entry.id)}>Delete</button>
                </div>
                <p style={{ fontSize: 11, color: "#888", marginBottom: 0 }}>
                  Regenerate re-runs fetch → classify → format for this same range, ignoring any cached result.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
