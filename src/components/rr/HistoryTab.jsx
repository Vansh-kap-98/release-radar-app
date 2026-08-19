import { useEffect, useState } from "react";
import { clearHistory, deleteHistoryEntry, getHistory } from "@/lib/api.js";
import { relativeTime, shortRef } from "@/lib/rr-utils";
import { Button, ErrorText, Panel } from "./ui";

export default function HistoryTab({ reloadKey, onRegenerate }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getHistory()
      .then((d) => alive && setEntries(d))
      .catch((e) => alive && setError(e?.message || "Could not load saved changelogs."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const act = async (fn) => {
    setError("");
    try {
      setEntries(await fn());
    } catch (e) {
      setError(e?.message || "That action failed.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted-foreground">
          {entries.length} saved changelog{entries.length === 1 ? "" : "s"}, newest first
        </p>
        <Button
          variant="danger"
          size="sm"
          onClick={() => act(clearHistory)}
          disabled={!entries.length}
        >
          Clear all
        </Button>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Panel className="text-[13px] text-muted-foreground">Loading saved changelogs...</Panel>
      ) : entries.length === 0 ? (
        <Panel className="text-center text-[13px] text-muted-foreground">
          No saved changelogs yet. Every changelog you generate is saved here automatically.
        </Panel>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const open = openId === e.id;
            return (
              <li key={e.id} className="rounded-lg border border-border bg-card">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : e.id)}
                  className="w-full rounded-lg px-3 py-2.5 text-left hover:bg-accent"
                >
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[13px] font-semibold">{e.repo}</span>
                    <span className="font-mono text-[12px] break-all text-muted-foreground">
                      {shortRef(e.range)}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                    {relativeTime(e.createdAt)}
                    {e.detailed ? " · detailed analysis" : ""}
                  </span>
                </button>
                {open ? (
                  <div className="space-y-2 border-t border-border p-3">
                    <pre className="max-h-[240px] overflow-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">
                      {e.markdown}
                    </pre>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(e.markdown);
                            setCopiedId(e.id);
                            setTimeout(() => setCopiedId(null), 1500);
                          } catch {
                            setError("Could not copy to the clipboard.");
                          }
                        }}
                      >
                        {copiedId === e.id ? "Copied" : "Copy markdown"}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => onRegenerate?.(e)}>
                        Regenerate
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => act(() => deleteHistoryEntry(e.id))}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
