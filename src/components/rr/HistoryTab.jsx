import { useEffect, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  FileClock,
  Layers,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { clearHistory, deleteHistoryEntry, getHistory } from "@/lib/api.js";
import { relativeTime, shortRef } from "@/lib/rr-utils";
import { Badge, Button, EmptyState, ErrorText, Panel, SkeletonRows } from "./ui";
import { cn } from "@/lib/utils";

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
    <div className="space-y-4">
      {/* Section header carries the count and the destructive action, aligned
          on a baseline rather than centred in a box. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Saved changelogs</h2>
          <p className="mt-0.5 max-w-[70ch] text-xs text-muted-foreground">
            Every changelog you generate is saved here automatically, newest first. Stored
            locally and capped at 200 entries.
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          onClick={() => act(clearHistory)}
          disabled={!entries.length}
        >
          <Trash2 aria-hidden="true" />
          Clear all
        </Button>
      </div>

      <ErrorText>{error}</ErrorText>

      {loading ? (
        <Panel flush>
          <span className="sr-only" role="status">
            Loading saved changelogs…
          </span>
          <SkeletonRows rows={3} />
        </Panel>
      ) : entries.length === 0 ? (
        <Panel flush>
          <EmptyState icon={FileClock} title="No saved changelogs yet">
            Generate one from the{" "}
            <span className="font-medium text-foreground">Generate</span> tab and it will
            appear here — including runs you never published.
          </EmptyState>
        </Panel>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => {
            const open = openId === e.id;
            return (
              <li
                key={e.id}
                className={cn(
                  "overflow-hidden rounded-lg border bg-card transition-colors",
                  open ? "border-border-strong shadow-sm" : "border-border shadow-xs",
                )}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`entry-${e.id}`}
                  onClick={() => setOpenId(open ? null : e.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover"
                >
                  <ChevronRight
                    className={cn(
                      "size-4 shrink-0 text-subtle-foreground transition-transform duration-200",
                      open && "rotate-90 text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="truncate text-sm font-semibold text-foreground">
                        {e.repo}
                      </span>
                      <span className="truncate font-mono text-2xs text-muted-foreground">
                        {shortRef(e.range)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-2xs text-muted-foreground">
                      {relativeTime(e.createdAt)}
                    </span>
                  </span>
                  {e.detailed ? (
                    <Badge tone="accent" className="hidden sm:inline-flex">
                      <Layers className="size-3" aria-hidden="true" />
                      detailed
                    </Badge>
                  ) : null}
                </button>

                {open ? (
                  <div id={`entry-${e.id}`} className="border-t border-border">
                    <pre className="max-h-[260px] overflow-auto bg-muted/40 px-4 py-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                      {e.markdown}
                    </pre>
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-4 py-2.5">
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
                        {copiedId === e.id ? (
                          <Check className="text-success" aria-hidden="true" />
                        ) : (
                          <Copy aria-hidden="true" />
                        )}
                        {copiedId === e.id ? "Copied" : "Copy markdown"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => onRegenerate?.(e)}>
                        <RotateCcw aria-hidden="true" />
                        Regenerate
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className="ml-auto"
                        onClick={() => act(() => deleteHistoryEntry(e.id))}
                      >
                        <Trash2 aria-hidden="true" />
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
