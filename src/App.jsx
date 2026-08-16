import React, { useEffect, useState } from "react";
import SettingsForm from "./components/SettingsForm";
import CommitPicker from "./components/CommitPicker";
import HistoryList from "./components/HistoryList";
import { suggestBump, nextVersion } from "./lib/semver";

export default function App() {
  const [tab, setTab] = useState("generate");
  const [repo, setRepo] = useState("");
  const [fromRef, setFromRef] = useState("");
  const [toRef, setToRef] = useState("");
  const [publishTarget, setPublishTarget] = useState("markdown-only");
  const [showManualRefs, setShowManualRefs] = useState(false);
  const [defaultBranch, setDefaultBranch] = useState(null);
  const [selectedStartSha, setSelectedStartSha] = useState(null);
  const [selectedEndSha, setSelectedEndSha] = useState(null);
  const [latestTag, setLatestTag] = useState(null);

  const [changes, setChanges] = useState(null);
  const [markdown, setMarkdown] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [versionBump, setVersionBump] = useState(null);
  const [versionOverride, setVersionOverride] = useState("");
  const [publishedUrl, setPublishedUrl] = useState(null);
  const [detailed, setDetailed] = useState(false);
  const [status, setStatus] = useState(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [fromCache, setFromCache] = useState(false);
  const [diffStats, setDiffStats] = useState(null);

  // Progress phases pushed from the main process.
  useEffect(() => {
    const unsubscribe = window.releaseRadar.onStatus((payload) => {
      setStatus(payload);
      if (payload.phase === "retry") setRetrySeconds(Math.ceil(payload.waitMs / 1000));
    });
    return unsubscribe;
  }, []);

  // Count the retry wait down so the UI doesn't look frozen during a backoff.
  useEffect(() => {
    if (status?.phase !== "retry" || retrySeconds <= 0) return;
    const timer = setTimeout(() => setRetrySeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, retrySeconds]);

  function phaseLabel(fallback) {
    if (!loading) return fallback;
    if (status?.phase === "retry") {
      return `Rate limited on ${status.provider}, retrying in ${Math.max(retrySeconds, 0)}s...`;
    }
    if (status?.phase === "github") return "Fetching from GitHub...";
    if (status?.phase === "ai") return status.detailed ? "Analyzing diffs with AI..." : "Classifying with AI...";
    if (status?.phase === "format") return "Formatting release notes...";
    return "Working...";
  }

  // Feature 2: auto-detect the latest tag + default branch as soon as a
  // valid "owner/name" repo is entered, pre-filling the range for the
  // common "what's changed since our last release" case.
  useEffect(() => {
    if (!repo || !repo.includes("/")) return;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const defaults = await window.releaseRadar.getRepoDefaults({ repo });
        if (cancelled) return;
        setDefaultBranch(defaults.defaultBranch || null);
        setLatestTag(defaults.latestTag || null);
        setFromRef((prev) => prev || defaults.latestTag || "");
        setToRef((prev) => prev || defaults.defaultBranch || "");
      } catch {
        // Repo may not exist yet, or token may be missing — picker/manual entry still work.
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [repo]);

  // Reset commit-picker selection whenever the repo changes.
  useEffect(() => {
    setSelectedStartSha(null);
    setSelectedEndSha(null);
    setDefaultBranch(null);
    setLatestTag(null);
  }, [repo]);

  // Feature 8: re-run the pipeline for a saved entry's range. force:true skips
  // the classification cache — regenerating a cached result would be a no-op.
  function handleRegenerate(entry) {
    const [entryFrom, entryTo] = (entry.range || "").split("...");
    if (!entryFrom || !entryTo) {
      setError(`Saved entry has an unreadable range: "${entry.range}"`);
      return;
    }

    setRepo(entry.repo);
    setFromRef(entryFrom);
    setToRef(entryTo);
    setDetailed(Boolean(entry.detailed));
    setTab("generate");

    handleFetch({
      repo: entry.repo,
      fromRef: entryFrom,
      toRef: entryTo,
      detailed: Boolean(entry.detailed),
      force: true
    });
  }

  function handlePickerSelect(startSha, endSha) {
    setSelectedStartSha(startSha);
    setSelectedEndSha(endSha);
    if (startSha) setFromRef(startSha);
    if (endSha) setToRef(endSha);
  }

  // Accepts explicit overrides so "Regenerate" can run against an entry's
  // values immediately, without waiting for the state updates to land.
  async function handleFetch(overrides = {}) {
    const params = {
      repo,
      fromRef,
      toRef,
      detailed,
      force: false,
      ...overrides
    };

    setLoading(true);
    setError(null);
    setMarkdown(null);
    setChanges(null);
    setVersionBump(null);
    setVersionOverride("");
    setPublishedUrl(null);
    setFromCache(false);
    setDiffStats(null);
    try {
      const result = await window.releaseRadar.fetchChanges(params);
      if (result.empty) {
        setError(`No changes found between ${params.fromRef} and ${params.toRef}.`);
      } else {
        setChanges(result.changes);
        setFromCache(Boolean(result.cached));
        setDiffStats(result.diffStats || null);
        // Feature 4: semver suggestion — pre-filled, never auto-applied.
        // The user can still edit the field before using it anywhere.
        const bump = suggestBump(result.changes);
        setVersionBump(bump);
        setVersionOverride(nextVersion(latestTag, bump) || "");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePublish(confirmed) {
    setLoading(true);
    setError(null);
    try {
      const result = await window.releaseRadar.publish({
        repo,
        range: `${fromRef}...${toRef}`,
        changes,
        markdown: confirmed ? markdown : undefined,
        publishTarget,
        confirmed,
        version: versionOverride,
        detailed
      });
      if (result.needsConfirm) {
        setMarkdown(result.markdown);
        setNeedsConfirm(true);
      } else {
        setMarkdown(result.markdown);
        setNeedsConfirm(false);
        setPublishedUrl(result.publishedUrl || null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 32, fontFamily: "sans-serif" }}>
      <h1>Release Radar</h1>

      <nav style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <button onClick={() => setTab("generate")} disabled={tab === "generate"}>
          Generate
        </button>
        <button onClick={() => setTab("history")} disabled={tab === "history"}>
          History
        </button>
        <button onClick={() => setTab("settings")} disabled={tab === "settings"}>
          Settings
        </button>
      </nav>

      {tab === "settings" && <SettingsForm onSaved={() => setTab("generate")} />}

      {tab === "history" && (
        <>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          <HistoryList onRegenerate={handleRegenerate} onError={setError} />
        </>
      )}

      {tab === "generate" && (
        <>
          <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
            <input placeholder="owner/name" value={repo} onChange={(e) => setRepo(e.target.value)} />

            {fromRef && toRef && (
              <p style={{ fontSize: 13, color: "#555", margin: 0 }}>
                Range: <code>{fromRef}</code> → <code>{toRef}</code>
              </p>
            )}

            {!showManualRefs && repo.includes("/") && (
              <CommitPicker
                repo={repo}
                branch={defaultBranch}
                selectedStart={selectedStartSha}
                selectedEnd={selectedEndSha}
                onSelect={handlePickerSelect}
                onError={setError}
              />
            )}

            <button
              type="button"
              onClick={() => setShowManualRefs((v) => !v)}
              style={{ justifySelf: "start", background: "none", border: "none", color: "#0366d6", cursor: "pointer", padding: 0, fontSize: 13 }}
            >
              {showManualRefs ? "Hide manual ref entry" : "Advanced: enter refs manually"}
            </button>

            {showManualRefs && (
              <>
                <input placeholder="from ref (e.g. v1.0.0)" value={fromRef} onChange={(e) => setFromRef(e.target.value)} />
                <input placeholder="to ref (e.g. main)" value={toRef} onChange={(e) => setToRef(e.target.value)} />
              </>
            )}

            <label style={{ fontSize: 13, display: "flex", alignItems: "flex-start", gap: 8 }}>
              <input
                type="checkbox"
                checked={detailed}
                onChange={(e) => setDetailed(e.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                Detailed analysis (uses file diffs — needs a paid or higher-limit API key)
                <br />
                <span style={{ color: "#888" }}>
                  Slower and uses far more tokens, but descriptions reflect the actual code change.
                </span>
              </span>
            </label>

            <button onClick={() => handleFetch()} disabled={loading || !fromRef || !toRef}>
              {phaseLabel("Fetch & classify")}
            </button>
          </div>

          {error && <p style={{ color: "crimson" }}>{error}</p>}

          {changes && changes.length > 0 && (
            <div>
              <h2>
                Classified changes{" "}
                {fromCache && (
                  <span style={{ fontSize: 12, fontWeight: "normal", color: "#888" }}>
                    (cached — no AI call made)
                  </span>
                )}
              </h2>

              {diffStats && (
                <p style={{ fontSize: 12, color: "#666", marginTop: -8 }}>
                  Detailed analysis: sent {diffStats.filesAnalyzed} file
                  {diffStats.filesAnalyzed === 1 ? "" : "s"} (
                  {(diffStats.patchChars / 1000).toFixed(1)}k chars of diff)
                  {diffStats.filesOmitted > 0 && `, ${diffStats.filesOmitted} omitted`}
                  {diffStats.filesWithoutPatch > 0 &&
                    `, ${diffStats.filesWithoutPatch} without a readable patch`}
                  .
                </p>
              )}
              <ul>
                {changes.map((c, i) => (
                  <li key={i}>
                    <strong>{c.category}</strong>: {c.title}
                  </li>
                ))}
              </ul>

              {versionBump && (
                <div style={{ marginTop: 12, padding: 12, background: "#f6f6f6", borderRadius: 4 }}>
                  <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                    Suggested bump: <strong>{versionBump}</strong>
                    {latestTag
                      ? ` (from ${latestTag})`
                      : " — no existing tag found, this would be your first release"}
                  </p>
                  <label style={{ fontSize: 13 }}>
                    Next version (edit freely — nothing is applied automatically)
                    <input
                      value={versionOverride}
                      onChange={(e) => setVersionOverride(e.target.value)}
                      placeholder="e.g. v1.5.0"
                      style={{ display: "block", width: 160, marginTop: 4 }}
                    />
                  </label>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 16 }}>
                <select value={publishTarget} onChange={(e) => setPublishTarget(e.target.value)}>
                  <option value="markdown-only">Markdown only</option>
                  <option value="github-release">Draft GitHub Release</option>
                  <option value="slack">Post to Slack</option>
                  <option value="pull-request">Open as Pull Request</option>
                </select>
                <button onClick={() => handlePublish(false)} disabled={loading}>
                  {phaseLabel("Generate")}
                </button>
              </div>

              {needsConfirm && (
                <div style={{ marginTop: 12, padding: 12, border: "1px solid #ddd" }}>
                  <p>
                    {publishTarget === "pull-request"
                      ? "This will create a new branch, update CHANGELOG.md, and open a Pull Request."
                      : `This will publish to ${publishTarget}.`}{" "}
                    Confirm?
                  </p>
                  <button onClick={() => handlePublish(true)} disabled={loading}>
                    {loading ? phaseLabel("Publishing...") : "Confirm & publish"}
                  </button>
                  {/* Errors also render near the top of the page, but that's
                      off-screen once the notes are long — repeat it here so a
                      failed publish is visible right where the click happened. */}
                  {error && <p style={{ color: "crimson", marginBottom: 0 }}>{error}</p>}
                </div>
              )}
            </div>
          )}

          {publishedUrl && (
            <p style={{ marginTop: 16 }}>
              Done —{" "}
              <a href={publishedUrl} target="_blank" rel="noreferrer">
                {publishedUrl}
              </a>
            </p>
          )}

          {markdown && (
            <div style={{ marginTop: 24 }}>
              <h2>Release notes</h2>
              <pre style={{ whiteSpace: "pre-wrap", background: "#f6f6f6", padding: 16 }}>{markdown}</pre>
            </div>
          )}
        </>
      )}
    </main>
  );
}
