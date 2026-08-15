import React, { useEffect, useState } from "react";
import SettingsForm from "./components/SettingsForm";
import CommitPicker from "./components/CommitPicker";
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

  function handlePickerSelect(startSha, endSha) {
    setSelectedStartSha(startSha);
    setSelectedEndSha(endSha);
    if (startSha) setFromRef(startSha);
    if (endSha) setToRef(endSha);
  }

  async function handleFetch() {
    setLoading(true);
    setError(null);
    setMarkdown(null);
    setChanges(null);
    setVersionBump(null);
    setVersionOverride("");
    setPublishedUrl(null);
    try {
      const result = await window.releaseRadar.fetchChanges({ repo, fromRef, toRef });
      if (result.empty) {
        setError(`No changes found between ${fromRef} and ${toRef}.`);
      } else {
        setChanges(result.changes);
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
        version: versionOverride
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
        <button onClick={() => setTab("settings")} disabled={tab === "settings"}>
          Settings
        </button>
      </nav>

      {tab === "settings" && <SettingsForm onSaved={() => setTab("generate")} />}

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

            <button onClick={handleFetch} disabled={loading || !fromRef || !toRef}>
              {loading ? "Fetching..." : "Fetch & classify"}
            </button>
          </div>

          {error && <p style={{ color: "crimson" }}>{error}</p>}

          {changes && changes.length > 0 && (
            <div>
              <h2>Classified changes</h2>
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
                  Generate
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
                  <button onClick={() => handlePublish(true)}>Confirm & publish</button>
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
