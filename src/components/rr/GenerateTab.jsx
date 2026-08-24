import { useCallback, useEffect, useRef, useState } from "react";
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
import { Badge, Button, ErrorText, Input, Label, Panel, Select, Toggle } from "./ui";

const PUBLISH_TARGETS = [
  { value: "markdown-only", label: "Markdown only" },
  { value: "github-release", label: "Draft GitHub Release" },
  { value: "slack", label: "Post to Slack" },
  { value: "pull-request", label: "Open as Pull Request" },
];

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
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
  const rangeLabel = fromRef && toRef ? `${shortRef(fromRef)} -> ${shortRef(toRef)}` : "";

  /* ------------------------------ fetch changes ----------------------------- */
  const buttonLabel = () => {
    if (!loading) return "Fetch & classify";
    switch (status.phase) {
      case "github":
        return "Fetching from GitHub...";
      case "ai":
        return status.detailed ? "Analyzing diffs with AI..." : "Classifying with AI...";
      case "format":
        return "Formatting release notes...";
      case "retry":
        return `Rate limited on ${status.provider ?? "provider"}, retrying in ${countdown}s...`;
      default:
        return "Working...";
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

  // Computed in the main process from core/semver.js — see main.js. Null when
  // the range start isn't a parseable version (a raw SHA, say), in which case
  // we show nothing rather than a wrong suggestion.
  // Feature 6a: local exports. Nothing leaves the machine, so these skip the
  // confirm-before-publish step the remote targets go through.
  const runExport = async (format, { save } = {}) => {
    setExportError("");
    setExportNote("");
    try {
      const title = `Release notes ${version || rangeLabel || repo}`.trim();
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

  const suggestion = result?.versionSuggestion ?? null;
  const hasSuggestion = Boolean(suggestion?.suggested);

  const targetLabel =
    PUBLISH_TARGETS.find((t) => t.value === publishTarget)?.label ?? publishTarget;

  return (
    <div className="space-y-4">
      <Panel className="space-y-2">
        <div>
          <Label htmlFor="repo">Repository</Label>
          <Input
            id="repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/name"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        {repo && !repoValid ? (
          <ErrorText>Use the format owner/name.</ErrorText>
        ) : rangeLabel ? (
          <p className="font-mono text-[12px] text-muted-foreground">Range: {rangeLabel}</p>
        ) : repoValid ? (
          <p className="text-[12px] text-muted-foreground">
            Pick a start and end commit, or set refs manually.
          </p>
        ) : null}
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

      <Panel className="space-y-3">
        <button
          type="button"
          onClick={() => setManualOpen((o) => !o)}
          className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
          aria-expanded={manualOpen}
        >
          {manualOpen ? "▾" : "▸"} Advanced: enter refs manually
        </button>
        {manualOpen ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="fromRef">From ref</Label>
              <Input
                id="fromRef"
                className="font-mono"
                value={manualFrom}
                onChange={(e) => setManualFrom(e.target.value)}
                placeholder="v1.2.0"
                spellCheck={false}
              />
            </div>
            <div>
              <Label htmlFor="toRef">To ref</Label>
              <Input
                id="toRef"
                className="font-mono"
                value={manualTo}
                onChange={(e) => setManualTo(e.target.value)}
                placeholder="main"
                spellCheck={false}
              />
            </div>
          </div>
        ) : null}

        <Toggle
          id="detailed"
          checked={detailed}
          onChange={setDetailed}
          label="Detailed analysis (uses file diffs — needs a paid or higher-limit API key)"
          description="Slower and uses far more tokens, but descriptions reflect the actual code change."
        />

        <div className="flex items-center gap-2">
          <Button
            onClick={() => runFetch()}
            disabled={!repoValid || !fromRef || !toRef || loading}
          >
            {buttonLabel()}
          </Button>
          {result?.cached ? (
            <Button variant="ghost" size="sm" onClick={() => runFetch({ force: true })}>
              Re-run without cache
            </Button>
          ) : null}
        </div>
        <ErrorText>{error}</ErrorText>
        {emptyMessage ? (
          <p className="text-[13px] text-muted-foreground">{emptyMessage}</p>
        ) : null}
      </Panel>

      {result ? (
        <>
          <Panel>
            <div className="mb-2 flex items-baseline gap-2">
              <h2 className="text-[13px] font-semibold">Classified changes</h2>
              {result.cached ? (
                <span className="text-[12px] text-muted-foreground">
                  (cached — no AI call made)
                </span>
              ) : null}
            </div>
            {result.diffStats ? (
              <p className="mb-2 text-[12px] text-muted-foreground">
                Detailed analysis: sent {result.diffStats.filesAnalyzed} files (
                {formatChars(result.diffStats.patchChars)} chars of diff)
                {result.diffStats.filesOmitted
                  ? `, ${result.diffStats.filesOmitted} omitted`
                  : ""}
              </p>
            ) : null}
            <ul className="divide-y divide-border">
              {result.changes.map((c) => (
                <li key={c.sha} className="flex items-start gap-2.5 py-2">
                  <Badge tone={c.category}>{c.category}</Badge>
                  <span className="min-w-0 flex-1 text-[13px] break-words">
                    {c.scope ? <span className="font-semibold">{c.scope}: </span> : null}
                    {c.title}
                  </span>
                  <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                    {c.sha.slice(0, 7)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel className="space-y-2">
            <h2 className="text-[13px] font-semibold">
              {hasSuggestion
                ? `Suggested next version: ${suggestion.suggested} (${suggestion.bump} bump)`
                : "No version suggestion available"}
              {hasSuggestion && suggestion.decidedBy ? (
                <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                  {suggestion.decidedBy === "ai" ? "· chosen by AI" : "· from category rules"}
                </span>
              ) : null}
            </h2>
            {suggestion?.reasoning ? (
              <p className="text-[12px] text-muted-foreground">{suggestion.reasoning}</p>
            ) : null}
            <div className="max-w-[220px]">
              <Label htmlFor="version">Version</Label>
              <Input
                id="version"
                className="font-mono"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="v1.5.0"
                spellCheck={false}
              />
            </div>
            <p className="text-[12px] text-muted-foreground">
              edit freely — nothing is applied automatically
            </p>
          </Panel>

          <Panel className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="target" className="mb-0 sr-only">
                Publish target
              </Label>
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
              <Button onClick={() => doPublish(false)} disabled={publishing}>
                {publishing && !needsConfirm ? "Generating..." : "Generate"}
              </Button>
            </div>

            {needsConfirm ? (
              <div className="space-y-2 rounded-md border border-cat-breaking/40 bg-cat-breaking-bg/40 p-3">
                <p className="text-[13px]">
                  {publishTarget === "pull-request"
                    ? "This will create a new branch, update CHANGELOG.md, and open a Pull Request. Confirm?"
                    : `This will publish to ${targetLabel}. Confirm?`}
                </p>
                <div className="flex items-center gap-2">
                  <Button onClick={() => doPublish(true)} disabled={publishing}>
                    {publishing ? "Publishing..." : "Confirm & publish"}
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
            ) : (
              <ErrorText>{publishError}</ErrorText>
            )}

            {publishedUrl ? (
              <p className="text-[13px] text-cat-feat">
                Published successfully —{" "}
                <a
                  href={publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono break-all underline"
                >
                  {publishedUrl}
                </a>
              </p>
            ) : null}

            {markdown ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold">Release notes</h3>
                  <CopyButton text={markdown} />
                </div>
                <pre className="max-h-[280px] overflow-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap">
                  {markdown}
                </pre>

                <div className="space-y-1.5">
                  <p className="text-[12px] text-muted-foreground">
                    Export a copy — stays on your machine, nothing is published.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => runExport("html")}>
                      Copy as HTML
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => runExport("text")}>
                      Copy as plain text
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => runExport("html", { save: true })}>
                      Save .html
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => runExport("text", { save: true })}>
                      Save .txt
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => runExport("markdown", { save: true })}>
                      Save .md
                    </Button>
                  </div>
                  {exportNote ? (
                    <p className="text-[12px] break-all text-cat-feat">{exportNote}</p>
                  ) : null}
                  <ErrorText>{exportError}</ErrorText>
                </div>
              </div>
            ) : null}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
