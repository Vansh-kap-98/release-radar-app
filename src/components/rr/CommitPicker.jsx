import { ChevronDown, GitCommitHorizontal, PackageSearch, SearchX } from "lucide-react";
import { cn } from "@/lib/utils";
import { firstLine, relativeTime } from "@/lib/rr-utils";
import { Button, EmptyState, ErrorText, PanelHeader, SkeletonRows } from "./ui";

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

  const selectedCount =
    startIdx >= 0 && endIdx >= 0 ? Math.abs(endIdx - startIdx) + 1 : startIdx >= 0 ? 1 : 0;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <PanelHeader
        title="Commits"
        meta={
          selectedCount > 0
            ? `${selectedCount} selected`
            : repoReady
              ? "Click one commit for the start, another for the end"
              : undefined
        }
      />

      <div className="scroll-slim max-h-[300px] overflow-y-auto overscroll-contain">
        {!repoReady ? (
          <EmptyState icon={PackageSearch} title="No repository yet">
            Enter an <span className="font-mono text-foreground">owner/name</span> above to
            load its commit history.
          </EmptyState>
        ) : loading ? (
          <>
            <span className="sr-only" role="status">
              Loading commits…
            </span>
            <SkeletonRows rows={5} />
          </>
        ) : error ? (
          <EmptyState icon={SearchX} title="Couldn't load commits" compact>
            {error}
          </EmptyState>
        ) : commits.length === 0 ? (
          <EmptyState icon={GitCommitHorizontal} title="No commits on this branch" compact>
            The branch exists but has no commit history to compare.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {commits.map((c, i) => {
              const isStart = c.sha === startSha;
              const isEnd = c.sha === endSha;
              const isEndpoint = isStart || isEnd;
              const between = inRange(i);

              return (
                <li key={c.sha}>
                  <button
                    type="button"
                    onClick={() => onPick(c)}
                    aria-pressed={isEndpoint}
                    className={cn(
                      "group relative flex w-full items-start gap-2.5 py-2.5 pr-4 pl-4 text-left",
                      "transition-colors duration-100",
                      // A left rail marks membership in the range. Colour alone
                      // carried this before, which is invisible to anyone who
                      // can't distinguish the two tints.
                      "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:transition-colors",
                      isEndpoint
                        ? "bg-accent-surface/70 before:bg-accent"
                        : between
                          ? "bg-range before:bg-accent/35"
                          : "before:bg-transparent hover:bg-hover",
                    )}
                  >
                    <GitCommitHorizontal
                      className={cn(
                        "mt-0.5 size-4 shrink-0 transition-colors",
                        isEndpoint
                          ? "text-accent"
                          : between
                            ? "text-accent/60"
                            : "text-subtle-foreground group-hover:text-muted-foreground",
                      )}
                      aria-hidden="true"
                    />

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "truncate text-sm text-foreground",
                            isEndpoint && "font-medium",
                          )}
                        >
                          {firstLine(c.message)}
                        </span>
                        {isEndpoint ? (
                          <span className="shrink-0 rounded-sm bg-accent px-1.5 py-px text-2xs font-semibold tracking-wide text-accent-foreground uppercase">
                            {isStart ? "start" : "end"}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
                        <span className="font-mono">{c.shortSha}</span>
                        <span aria-hidden="true" className="text-border-strong">
                          /
                        </span>
                        <span className="truncate">{c.author}</span>
                        <span aria-hidden="true" className="text-border-strong">
                          /
                        </span>
                        <span className="shrink-0">{relativeTime(c.date)}</span>
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
        <div className="border-t border-border bg-danger-surface/50 px-4 py-2">
          <ErrorText>{validationMessage}</ErrorText>
        </div>
      ) : null}

      {repoReady && hasNextPage && !loading ? (
        <div className="border-t border-border px-4 py-2">
          <Button variant="ghost" size="sm" onClick={onLoadMore} loading={loadingMore}>
            {!loadingMore ? <ChevronDown aria-hidden="true" /> : null}
            {loadingMore ? "Loading…" : "Load older commits"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
