import React, { useEffect, useState } from "react";

function relativeDate(dateStr) {
  if (!dateStr) return "";
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months > 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

// Click one commit to set the start point, click another to set the end
// point. Commits come back newest-first, so "more recent than start" means
// an earlier index in the list.
export default function CommitPicker({ repo, branch, selectedStart, selectedEnd, onSelect, onError }) {
  const [commits, setCommits] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pickerError, setPickerError] = useState(null);

  // Debounced so a half-typed repo ("owner/r", "owner/re", ...) doesn't fire
  // a 404 per keystroke, and cancellable so a stale in-flight response can't
  // overwrite state — or leave a phantom error — after a newer one lands.
  useEffect(() => {
    setCommits([]);
    setHasNextPage(false);
    setPickerError(null);
    if (!repo || !repo.includes("/")) return;

    let cancelled = false;
    const timeout = setTimeout(() => {
      loadPage(1, true, () => cancelled);
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, branch]);

  async function loadPage(pageToLoad, replace, isCancelled = () => false) {
    setLoading(true);
    try {
      const result = await window.releaseRadar.listCommits({ repo, branch, page: pageToLoad });
      if (isCancelled()) return;
      setCommits((prev) => (replace ? result.commits : [...prev, ...result.commits]));
      setHasNextPage(result.hasNextPage);
      setPage(pageToLoad);
      onError?.(null); // clear any earlier failure now that this one worked
    } catch (err) {
      if (isCancelled()) return;
      onError?.(err.message);
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }

  function handleClick(commit) {
    setPickerError(null);

    if (!selectedStart || selectedEnd) {
      onSelect(commit.sha, null);
      return;
    }

    if (commit.sha === selectedStart) {
      onSelect(null, null);
      return;
    }

    const startIndex = commits.findIndex((c) => c.sha === selectedStart);
    const clickedIndex = commits.findIndex((c) => c.sha === commit.sha);

    if (startIndex === -1 || clickedIndex === -1 || clickedIndex >= startIndex) {
      setPickerError("End must be more recent than start — pick a commit above it in the list.");
      return;
    }

    onSelect(selectedStart, commit.sha);
  }

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 4, marginBottom: 16 }}>
      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {commits.map((c) => {
          const isStart = c.sha === selectedStart;
          const isEnd = c.sha === selectedEnd;
          return (
            <div
              key={c.sha}
              onClick={() => handleClick(c)}
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid #eee",
                cursor: "pointer",
                background: isStart || isEnd ? "#e6f4ff" : "white"
              }}
            >
              <div style={{ fontSize: 13 }}>
                {isStart ? "🟢 start — " : isEnd ? "🔴 end — " : ""}
                {(c.message.split("\n")[0] || "(no message)").slice(0, 100)}
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                {c.shortSha} · {c.author} · {relativeDate(c.date)}
              </div>
            </div>
          );
        })}
        {commits.length === 0 && !loading && (
          <div style={{ padding: 12, color: "#888" }}>No commits to show yet — enter a repo above.</div>
        )}
      </div>
      <div style={{ padding: 8, textAlign: "center" }}>
        {hasNextPage && (
          <button onClick={() => loadPage(page + 1, false)} disabled={loading}>
            {loading ? "Loading..." : "Load older commits"}
          </button>
        )}
      </div>
      {pickerError && (
        <p style={{ color: "crimson", fontSize: 12, padding: "0 12px 8px" }}>{pickerError}</p>
      )}
    </div>
  );
}
