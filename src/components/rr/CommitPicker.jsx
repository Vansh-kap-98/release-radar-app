import { cn } from "@/lib/utils";
import { firstLine, relativeTime } from "@/lib/rr-utils";
import { Button, ErrorText } from "./ui";

/**
 * Commits are newest-first. "start" is the older boundary, "end" the newer one.
 */
export default function CommitPicker({
  commits,
  loading,
  error,
  repoReady,
  startSha,
  endSha,
  onPick,
  hasNextPage,
  onLoadMore,
  loadingMore,
  validationMessage,
}) {
  const indexOf = (sha) => commits.findIndex((c) => c.sha === sha);
  const startIdx = indexOf(startSha);
  const endIdx = indexOf(endSha);

  const inRange = (i) => {
    if (startIdx < 0 || endIdx < 0) return false;
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    return i > lo && i < hi;
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-[13px] font-semibold">Commits</h2>
        <p className="text-[12px] text-muted-foreground">
          Click a commit to set the start, then another to set the end
        </p>
      </div>

      <div className="max-h-[280px] overflow-y-auto">
        {!repoReady ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            Enter a repository above (for example{" "}
            <span className="font-mono">acme/release-radar</span>) to load its commits.
          </p>
        ) : loading ? (
          <ul className="animate-pulse divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="px-3 py-2.5">
                <div className="h-3 w-2/3 rounded bg-muted" />
                <div className="mt-2 h-2.5 w-1/3 rounded bg-muted" />
              </li>
            ))}
          </ul>
        ) : error ? (
          <div className="px-3 py-8 text-center">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : commits.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
            No commits found on this branch.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {commits.map((c, i) => {
              const isStart = c.sha === startSha;
              const isEnd = c.sha === endSha;
              return (
                <li key={c.sha}>
                  <button
                    type="button"
                    onClick={() => onPick(c)}
                    aria-pressed={isStart || isEnd}
                    className={cn(
                      "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent",
                      inRange(i) && "bg-range",
                      (isStart || isEnd) && "bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1 h-2 w-2 shrink-0 rounded-full",
                        isStart
                          ? "bg-cat-feat ring-2 ring-cat-feat/30"
                          : isEnd
                            ? "bg-cat-breaking ring-2 ring-cat-breaking/30"
                            : "bg-border",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] text-foreground">
                          {firstLine(c.message)}
                        </span>
                        {isStart ? (
                          <span className="shrink-0 rounded bg-cat-feat-bg px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-cat-feat uppercase">
                            start
                          </span>
                        ) : null}
                        {isEnd ? (
                          <span className="shrink-0 rounded bg-cat-breaking-bg px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-cat-breaking uppercase">
                            end
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        <span className="font-mono">{c.shortSha}</span> · {c.author} ·{" "}
                        {relativeTime(c.date)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {validationMessage ? (
        <div className="border-t border-border px-3 py-2">
          <ErrorText>{validationMessage}</ErrorText>
        </div>
      ) : null}

      {repoReady && hasNextPage && !loading ? (
        <div className="border-t border-border px-3 py-2">
          <Button variant="secondary" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Loading..." : "Load older commits"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
