import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  CloudUpload,
  Copy,
  ExternalLink,
  FileCode2,
  FileDown,
  FileText,
  ListChecks,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Tag,
} from "lucide-react";
import {
  fetchChanges,
  getRepoDefaults,
  listCommits,
  onStatus,
  publish as publishApi,
  exportNotes,
  exportSave,
} from "@/lib/api.js";
import { formatChars, isValidRepo, shortRef } from "@/lib/rr-utils";
import CommitPicker from "./CommitPicker";
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  ErrorText,
  Field,
  Input,
  Label,
  Panel,
  PanelHeader,
  Select,
  Toggle,
} from "./ui";
import { cn } from "@/lib/utils";

const PUBLISH_TARGETS = [
  { value: "markdown-only", label: "Markdown only" },
  { value: "github-release", label: "Draft GitHub Release" },
  { value: "slack", label: "Post to Slack" },
  { value: "pull-request", label: "Open as Pull Request" },
];

// Category order for the review list. Breaking first, chores last — the same
// order the formatter uses in the output, so the preview matches the result.
const CATEGORY_ORDER = ["breaking", "feat", "fix", "docs", "chore"];

/**
 * One stage of the pipeline. The numbered rail on the left is the layout's
 * spine: it gives the page a real alignment grid and an asymmetric column,
 * and it makes the three-stage flow (pick a range, review, publish) legible
 * instead of reading as three interchangeable cards.
 */
function Step({ index, title, description, icon: Icon, children, last = false }) {
  return (
    <section className="relative flex gap-3 sm:gap-4">
      {/* Rail. Hidden below sm, where a 40px gutter costs more than it gives. */}
      <div className="hidden shrink-0 flex-col items-center sm:flex">
        <span className="flex size-7 items-center justify-center rounded-full border border-border bg-card text-xs font-semibold text-muted-foreground shadow-xs">
          {index}
        </span>
        {!last ? <span aria-hidden="true" className="mt-1 w-px flex-1 bg-border" /> : null}
      </div>

      <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-6")}>
        <div className="mb-3 flex items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground sm:hidden" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              <span className="text-muted-foreground sm:hidden">{index}. </span>
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 max-w-[70ch] text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

function CopyButton({ text, label = "Copy", size = "sm" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? (
        <Check className="text-success" aria-hidden="true" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      {copied ? "Copied" : label}
    </Button>
  );
}

export default function GenerateTab({ onSaved, prefill }) {
  const [repo, setRepo] = useState("");
  const [defaults, setDefaults] = useState(null);

  const [commits, setCommits] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [commitError, setCommitError] = useState("");

  const [startSha, setStartSha] = useState(null);
  const [endSha, setEndSha] = useState(null);
  const [pickError, setPickError] = useState("");

  const [manualOpen, setManualOpen] = useState(false);
  const [manualFrom, setManualFrom] = useState("");
  const [manualTo, setManualTo] = useState("");

  const [detailed, setDetailed] = useState(false);

  const [status, setStatus] = useState({ phase: "idle" });
  const [countdown, setCountdown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [result, setResult] = useState(null);
  const [emptyMessage, setEmptyMessage] = useState("");

  const [version, setVersion] = useState("");
  const [publishTarget, setPublishTarget] = useState("markdown-only");
  const [markdown, setMarkdown] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [exportNote, setExportNote] = useState("");
  const [exportError, setExportError] = useState("");

  const repoValid = isValidRepo(repo);
  const debounceRef = useRef(null);

  // "Regenerate" from History hands us a saved entry. Applying it is a
  // two-step dance: state has to settle before fromRef/toRef derive correctly,
  // so we flag a pending fetch and fire it once the refs are populated.
  const [pendingFetch, setPendingFetch] = useState(false);
  const prefillRef = useRef(null);

  useEffect(() => {
    if (!prefill || prefill === prefillRef.current) return;
    prefillRef.current = prefill;
    const [from, to] = String(prefill.range || "").split("...");
    if (!from || !to) return;
    setRepo(prefill.repo || "");
    setManualOpen(true);
    setManualFrom(from);
    setManualTo(to);
    setDetailed(Boolean(prefill.detailed));
    setPendingFetch(true);
  }, [prefill]);

  /* ------------------------------- status feed ------------------------------ */
  useEffect(() => onStatus((payload) => setStatus(payload ?? { phase: "idle" })), []);

  useEffect(() => {
    if (status.phase !== "retry") {
      setCountdown(0);
      return;
    }
    setCountdown(Math.ceil((status.waitMs ?? 0) / 1000));
    const id = setInterval(() => setCountdown((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [status]);

  /* ---------------------------- repo -> commits ----------------------------- */
  const loadRepo = useCallback(async (value) => {
    setLoadingCommits(true);
    setCommitError("");
    setCommits([]);
    setStartSha(null);
    setEndSha(null);
    setPage(1);
    try {
      const d = await getRepoDefaults({ repo: value });
      setDefaults(d);
      const res = await listCommits({ repo: value, branch: d.defaultBranch, page: 1 });
      setCommits(res.commits);
      setHasNextPage(Boolean(res.hasNextPage));
    } catch (e) {
      setDefaults(null);
      setCommitError(e?.message || "Could not load commits for that repository.");
    } finally {
      setLoadingCommits(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!repoValid) {
      setDefaults(null);
      setCommits([]);
      return;
    }
    debounceRef.current = setTimeout(() => loadRepo(repo.trim()), 400);
    return () => clearTimeout(debounceRef.current);
  }, [repo, repoValid, loadRepo]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = page + 1;
      const res = await listCommits({
        repo: repo.trim(),
        branch: defaults?.defaultBranch ?? "main",
        page: next,
      });
      setCommits((prev) => [...prev, ...res.commits]);
      setHasNextPage(Boolean(res.hasNextPage));
      setPage(next);
    } catch (e) {
      setCommitError(e?.message || "Could not load older commits.");
    } finally {
      setLoadingMore(false);
    }
  };

  /* -------------------------------- selection ------------------------------- */
  const pick = (commit) => {
    setPickError("");
    if (startSha === commit.sha) {
      setStartSha(null);
      setEndSha(null);
      return;
    }
    if (!startSha) {
      setStartSha(commit.sha);
      return;
    }
    const startIdx = commits.findIndex((c) => c.sha === startSha);
    const idx = commits.findIndex((c) => c.sha === commit.sha);
    // newest-first list: a smaller index means a more recent commit
    if (idx > startIdx) {
      setPickError("End must be more recent than start");
      return;
    }
    setEndSha(commit.sha);
  };

  const fromRef = manualOpen && manualFrom ? manualFrom : startSha || defaults?.latestTag || "";
  const toRef =
    manualOpen && manualTo ? manualTo : endSha || (startSha ? "" : defaults?.defaultBranch || "");
  const rangeReady = Boolean(fromRef && toRef);

  /* ------------------------------ fetch changes ----------------------------- */
  const statusLabel = () => {
    switch (status.phase) {
      case "github":
        return "Fetching from GitHub…";
      case "ai":
        return status.detailed ? "Analyzing diffs with AI…" : "Classifying with AI…";
      case "format":
        return "Formatting release notes…";
      case "retry":
        return `Rate limited on ${status.provider ?? "provider"} — retrying in ${countdown}s`;
      default:
        return "Working…";
    }
  };

  const runFetch = async ({ force = false } = {}) => {
    setLoading(true);
    setError("");
    setEmptyMessage("");
    setResult(null);
    setMarkdown("");
    setPublishedUrl("");
    setNeedsConfirm(false);
    setPublishError("");
    try {
      const res = await fetchChanges({ repo: repo.trim(), fromRef, toRef, detailed, force });
      if (res.empty || !res.changes?.length) {
        setEmptyMessage(`No changes found between ${shortRef(fromRef)} and ${shortRef(toRef)}`);
        setResult(null);
      } else {
        setResult(res);
        // Pre-fill only; the field stays editable and nothing auto-publishes.
        setVersion(res.versionSuggestion?.suggested ?? "");
      }
    } catch (e) {
      setError(e?.message || "Something went wrong while classifying commits.");
    } finally {
      setLoading(false);
      setStatus({ phase: "idle" });
    }
  };

  useEffect(() => {
    if (!pendingFetch || !repoValid || !fromRef || !toRef) return;
    setPendingFetch(false);
    // force: true — the backend caches by (repo, refs, detailed), so a plain
    // refetch would hand back the very result the user asked to regenerate.
    runFetch({ force: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFetch, repoValid, fromRef, toRef]);

  /* --------------------------------- publish -------------------------------- */
  const doPublish = async (confirmed) => {
    setPublishing(true);
    setPublishError("");
    try {
      const res = await publishApi({
        repo: repo.trim(),
        range: `${fromRef}...${toRef}`,
        changes: result?.changes ?? [],
        markdown: confirmed ? markdown : "",
        publishTarget,
        confirmed,
        version,
        detailed,
      });
      setMarkdown(res.markdown || "");
      setNeedsConfirm(Boolean(res.needsConfirm));
      if (res.publishedUrl) setPublishedUrl(res.publishedUrl);
      if (res.published || !res.needsConfirm) onSaved?.();
    } catch (e) {
      setPublishError(e?.message || "Publishing failed. Nothing was changed.");
    } finally {
      setPublishing(false);
    }
  };

  // Feature 6a: local exports. Nothing leaves the machine, so these skip the
  // confirm-before-publish step the remote targets go through.
  const runExport = async (format, { save } = {}) => {
    setExportError("");
    setExportNote("");
    try {
      const title = `Release notes ${version || `${shortRef(fromRef)}..${shortRef(toRef)}` || repo}`.trim();
      if (save) {
        const res = await exportSave({
          markdown,
          format,
          title,
          defaultName: version ? `CHANGELOG-${version}` : "CHANGELOG",
        });
        setExportNote(res.saved ? `Saved to ${res.path}` : "");
        return;
      }
      const { content } = await exportNotes({ markdown, format, title });
      await navigator.clipboard?.writeText(content);
      setExportNote(format === "html" ? "HTML copied to clipboard" : "Plain text copied to clipboard");
    } catch (e) {
      setExportError(e?.message || "Export failed.");
    }
  };

  // Computed in the main process from core/semver.js — see main.js. Null when
  // the range start isn't a parseable version (a raw SHA, say), in which case
  // we show nothing rather than a wrong suggestion.
  const suggestion = result?.versionSuggestion ?? null;
  const hasSuggestion = Boolean(suggestion?.suggested);

  const targetLabel =
    PUBLISH_TARGETS.find((t) => t.value === publishTarget)?.label ?? publishTarget;

  const changes = result?.changes ?? [];
  const counts = CATEGORY_ORDER.map((key) => ({
    key,
    count: changes.filter((c) => c.category === key).length,
  })).filter((c) => c.count > 0);

  const sortedChanges = [...changes].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );

  return (
    <div>
      {/* ------------------------------ 1. source ------------------------------ */}
      <Step
        index={1}
        icon={ScanSearch}
        title="Choose a range"
        description="Pick the two commits to compare, or type refs directly."
      >
        <div className="space-y-3">
          <Panel className="space-y-4">
            {/* Deliberately not full-bleed: an owner/name is ~25 characters, and
                a 900px-wide input for it reads as an unconsidered default. */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <Field
                label="Repository"
                htmlFor="repo"
                error={repo && !repoValid ? "Use the format owner/name." : ""}
                className="w-full sm:max-w-[22rem]"
              >
                <Input
                  id="repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="owner/name"
                  spellCheck={false}
                  autoComplete="off"
                  aria-invalid={Boolean(repo && !repoValid)}
                  className="font-mono"
                />
              </Field>

              {/* The resolved range is the single most important derived fact on
                  this screen, so it gets its own right-aligned readout rather
                  than a line of grey text under the input. */}
              <div className="sm:pt-1 sm:text-right">
                <p className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
                  Range
                </p>
                {rangeReady ? (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-xs text-foreground sm:justify-end">
                    <span className="rounded-sm bg-muted px-1.5 py-0.5">{shortRef(fromRef)}</span>
                    <ArrowRight className="size-3.5 text-subtle-foreground" aria-hidden="true" />
                    <span className="rounded-sm bg-muted px-1.5 py-0.5">{shortRef(toRef)}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-subtle-foreground">Not set</p>
                )}
              </div>
            </div>
          </Panel>

          <CommitPicker
            commits={commits}
            loading={loadingCommits}
            error={commitError}
            repoReady={repoValid}
            startSha={startSha}
            endSha={endSha}
            onPick={pick}
            hasNextPage={hasNextPage}
            onLoadMore={loadMore}
            loadingMore={loadingMore}
            validationMessage={pickError}
          />

          <Panel className="space-y-4">
            <div>
              <button
                type="button"
                onClick={() => setManualOpen((o) => !o)}
                aria-expanded={manualOpen}
                aria-controls="manual-refs"
                className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 transition-transform duration-200",
                    manualOpen && "rotate-90",
                  )}
                  aria-hidden="true"
                />
                Enter refs manually
              </button>

              {manualOpen ? (
                <div id="manual-refs" className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label="From ref" htmlFor="fromRef">
                    <Input
                      id="fromRef"
                      className="font-mono"
                      value={manualFrom}
                      onChange={(e) => setManualFrom(e.target.value)}
                      placeholder="v1.2.0"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="To ref" htmlFor="toRef">
                    <Input
                      id="toRef"
                      className="font-mono"
                      value={manualTo}
                      onChange={(e) => setManualTo(e.target.value)}
                      placeholder="main"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </Field>
                </div>
              ) : null}
            </div>

            <div className="border-t border-border pt-4">
              <Toggle
                id="detailed"
                checked={detailed}
                onChange={setDetailed}
                label="Detailed analysis"
                description="Sends file diffs so descriptions reflect the actual code change, not just the commit message. Slower, and uses far more tokens — needs a paid or higher-limit API key."
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <Button
                variant="primary"
                size="lg"
                onClick={() => runFetch()}
                disabled={!repoValid || !rangeReady}
                loading={loading}
              >
                {!loading ? <Sparkles aria-hidden="true" /> : null}
                {loading ? statusLabel() : "Fetch & classify"}
              </Button>

              {result?.cached ? (
                <Button variant="ghost" size="md" onClick={() => runFetch({ force: true })}>
                  <RotateCcw aria-hidden="true" />
                  Re-run without cache
                </Button>
              ) : null}

              {loading && status.phase === "retry" ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                  <AlertTriangle className="size-3.5" aria-hidden="true" />
                  Provider is rate limiting — retry {status.attempt}/{status.maxRetries}
                </span>
              ) : null}
            </div>

            <ErrorText>{error}</ErrorText>
            {emptyMessage ? (
              <Callout tone="info" icon={ListChecks} title="Nothing to release">
                {emptyMessage}. Try widening the range, or check that the end ref is more
                recent than the start.
              </Callout>
            ) : null}
          </Panel>
        </div>
      </Step>

      {/* ------------------------------ 2. review ------------------------------ */}
      <Step
        index={2}
        icon={ListChecks}
        title="Review the classification"
        description="Every entry traces back to a real commit in the range. Nothing is published yet."
      >
        {!result ? (
          <Panel flush>
            <EmptyState icon={ListChecks} title="No results yet" compact>
              Classified changes and a suggested version will appear here once you run
              step 1.
            </EmptyState>
          </Panel>
        ) : (
          <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
              <PanelHeader
                title="Classified changes"
                meta={`${changes.length} ${changes.length === 1 ? "entry" : "entries"}`}
                actions={
                  <div className="flex items-center gap-1.5">
                    {counts.map(({ key, count }) => (
                      <Badge key={key} tone={key}>
                        {count} {key}
                      </Badge>
                    ))}
                    {result.cached ? (
                      <Badge tone="outline">cached</Badge>
                    ) : null}
                  </div>
                }
              />

              {result.rangeTruncated ? (
                <Callout
                  tone="warning"
                  icon={AlertTriangle}
                  title="This range is incomplete"
                  className="m-3 mb-0"
                >
                  Only the {result.rangeTruncated.commitsAnalyzed} most recent of{" "}
                  {result.rangeTruncated.totalCommits} commits were analyzed — GitHub's
                  compare API caps a range at 250. Split this into smaller releases for a
                  complete changelog.
                </Callout>
              ) : null}

              <ul className="divide-y divide-border">
                {sortedChanges.map((c) => (
                  <li
                    key={`${c.sha}-${c.title}`}
                    className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-hover"
                  >
                    {/* Fixed-width badge column so titles start on one vertical
                        line instead of ragging with badge width. */}
                    <span className="w-[4.5rem] shrink-0 pt-px">
                      <Badge tone={c.category}>{c.category}</Badge>
                    </span>
                    <span className="min-w-0 flex-1 text-sm break-words">
                      {c.scope ? (
                        <span className="font-semibold text-foreground">{c.scope}: </span>
                      ) : null}
                      <span className="text-foreground">{c.title}</span>
                    </span>
                    <span className="shrink-0 pt-0.5 font-mono text-2xs text-muted-foreground">
                      {c.sha.slice(0, 7)}
                    </span>
                  </li>
                ))}
              </ul>

              {result.diffStats ? (
                <p className="border-t border-border bg-muted/40 px-4 py-2 text-2xs text-muted-foreground">
                  Detailed analysis sent{" "}
                  <span className="font-mono text-foreground">
                    {result.diffStats.filesIncluded}
                  </span>{" "}
                  {result.diffStats.filesIncluded === 1 ? "file" : "files"} and{" "}
                  <span className="font-mono text-foreground">
                    {formatChars(result.diffStats.totalDiffChars)}
                  </span>{" "}
                  characters of diff
                  {result.diffStats.filesOmitted
                    ? ` (${result.diffStats.filesOmitted} omitted)`
                    : ""}
                  .
                </p>
              ) : null}
            </div>

            {/* Version: suggestion on the left as prose, the editable field on
                the right. Two different jobs, so they don't stack identically. */}
            <Panel>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tag className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <h3 className="text-sm font-semibold tracking-tight">
                      {hasSuggestion ? "Suggested version" : "No version suggestion"}
                    </h3>
                    {hasSuggestion && suggestion.decidedBy ? (
                      <Badge tone={suggestion.decidedBy === "ai" ? "accent" : "neutral"}>
                        {suggestion.decidedBy === "ai" ? "chosen by AI" : "category rules"}
                      </Badge>
                    ) : null}
                  </div>
                  {hasSuggestion ? (
                    <p className="mt-2 flex items-baseline gap-2">
                      <span className="font-mono text-base font-semibold text-foreground">
                        {suggestion.suggested}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {suggestion.bump} bump
                      </span>
                    </p>
                  ) : null}
                  {suggestion?.reasoning ? (
                    <p className="mt-1.5 max-w-[68ch] text-xs leading-relaxed text-muted-foreground">
                      {suggestion.reasoning}
                    </p>
                  ) : null}
                </div>

                <Field
                  label="Version to use"
                  htmlFor="version"
                  hint="Edit freely — nothing is applied automatically."
                  className="w-full sm:w-[13rem] sm:shrink-0"
                >
                  <Input
                    id="version"
                    className="font-mono"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="v1.5.0"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Field>
              </div>
            </Panel>
          </div>
        )}
      </Step>

      {/* ----------------------------- 3. publish ----------------------------- */}
      <Step
        index={3}
        icon={CloudUpload}
        title="Generate and publish"
        description="Remote targets always ask for confirmation, and publish exactly what you reviewed."
        last
      >
        {!result ? (
          <Panel flush>
            <EmptyState icon={CloudUpload} title="Nothing to publish yet" compact>
              Run step 1 to produce a changelog you can export or publish.
            </EmptyState>
          </Panel>
        ) : (
          <div className="space-y-3">
            <Panel className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Destination" htmlFor="target" className="min-w-[13rem] flex-1">
                  <Select
                    id="target"
                    value={publishTarget}
                    onChange={(e) => {
                      setPublishTarget(e.target.value);
                      setNeedsConfirm(false);
                      setPublishedUrl("");
                      setPublishError("");
                    }}
                  >
                    {PUBLISH_TARGETS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button
                  variant={markdown ? "secondary" : "primary"}
                  size="md"
                  onClick={() => doPublish(false)}
                  loading={publishing && !needsConfirm}
                >
                  {!(publishing && !needsConfirm) ? <FileText aria-hidden="true" /> : null}
                  {markdown ? "Regenerate notes" : "Generate notes"}
                </Button>
              </div>

              {needsConfirm ? (
                <div className="rounded-md border border-warning/30 bg-warning-surface p-3">
                  <div className="flex gap-2.5">
                    <AlertTriangle
                      className="mt-px size-4 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 space-y-3">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">Confirm before publishing</p>
                        <p className="max-w-[70ch] text-xs leading-relaxed text-foreground">
                          {publishTarget === "pull-request"
                            ? "This creates a new branch, commits CHANGELOG.md, and opens a pull request on the repository."
                            : `This publishes the notes below to ${targetLabel}.`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="primary"
                          size="md"
                          onClick={() => doPublish(true)}
                          loading={publishing}
                        >
                          {!publishing ? <CloudUpload aria-hidden="true" /> : null}
                          {publishing ? "Publishing…" : `Publish to ${targetLabel}`}
                        </Button>
                        <Button
                          variant="ghost"
                          size="md"
                          onClick={() => setNeedsConfirm(false)}
                          disabled={publishing}
                        >
                          Cancel
                        </Button>
                      </div>
                      <ErrorText>{publishError}</ErrorText>
                    </div>
                  </div>
                </div>
              ) : (
                <ErrorText>{publishError}</ErrorText>
              )}

              {publishedUrl ? (
                <Callout tone="success" icon={Check} title="Published">
                  <a
                    href={publishedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono break-all text-success underline decoration-success/40 underline-offset-2 transition-colors hover:decoration-success"
                  >
                    {publishedUrl}
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                  </a>
                </Callout>
              ) : null}
            </Panel>

            {markdown ? (
              <div className="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
                <PanelHeader
                  title="Release notes"
                  meta={version || undefined}
                  actions={<CopyButton text={markdown} label="Copy markdown" />}
                />
                <pre className="scroll-slim max-h-[320px] overflow-auto bg-muted/40 px-4 py-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
                  {markdown}
                </pre>

                <div className="space-y-2.5 border-t border-border px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <Label className="mb-0">Export a copy</Label>
                    <span className="text-2xs text-muted-foreground">
                      Stays on your machine
                    </span>
                  </div>

                  {/* Two groups, separated by a divider: clipboard actions and
                      file actions. Previously five equal-weight buttons in one
                      row, which made "Save .md" look like "Copy as HTML". */}
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                    <Button variant="secondary" size="sm" onClick={() => runExport("html")}>
                      <Clipboard aria-hidden="true" />
                      HTML
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => runExport("text")}>
                      <Clipboard aria-hidden="true" />
                      Plain text
                    </Button>

                    <span
                      aria-hidden="true"
                      className="mx-1 hidden h-4 w-px self-center bg-border sm:block"
                    />

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runExport("markdown", { save: true })}
                    >
                      <FileDown aria-hidden="true" />
                      .md
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runExport("html", { save: true })}
                    >
                      <FileCode2 aria-hidden="true" />
                      .html
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runExport("text", { save: true })}
                    >
                      <FileDown aria-hidden="true" />
                      .txt
                    </Button>
                  </div>

                  {exportNote ? (
                    <p className="flex items-start gap-1.5 text-xs break-all text-success">
                      <Check className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                      {exportNote}
                    </p>
                  ) : null}
                  <ErrorText>{exportError}</ErrorText>
                </div>
              </div>
            ) : (
              <Panel flush>
                <EmptyState icon={FileText} title="No notes generated yet" compact>
                  Choose a destination and select{" "}
                  <span className="font-medium text-foreground">Generate notes</span>. Markdown
                  only writes nothing anywhere.
                </EmptyState>
              </Panel>
            )}
          </div>
        )}
      </Step>

      {/* Screen readers get the pipeline phase announced; sighted users read it
          on the button itself. */}
      <span role="status" aria-live="polite" className="sr-only">
        {loading ? statusLabel() : ""}
      </span>
    </div>
  );
}
