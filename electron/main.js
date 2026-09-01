const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { getSecret, setSecret, getAll } = require("./lib/store");
// Pipeline logic lives in ../core (no Electron dependency) so the same code
// can run in the desktop app and in the companion GitHub Action.
const { fetchChangeRange, listCommits, getRepoDefaults } = require("../core/github");
const { classifyChanges, formatReleaseNotes } = require("../core/ai");
const { nextVersion } = require("../core/semver");
const { markdownToHtml, markdownToPlainText } = require("../core/export");
const { publishGithubRelease, postToSlack, openChangelogPullRequest } = require("../core/publish");
const { listHistory, addHistoryEntry, deleteHistoryEntry, clearHistory } = require("./lib/history");

const isDev = process.env.NODE_ENV === "development";

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// --- Settings (API keys), stored encrypted on disk via safeStorage ---

ipcMain.handle("settings:get", () => getAll());

ipcMain.handle("settings:set", (_event, { key, value }) => {
  setSecret(key, value);
  return true;
});

// --- Step 1: fetch + classify ---

// Session-scoped cache of classification results, keyed by the inputs that
// affect the answer. Changing any input yields a different key, so edits
// naturally bypass the cache without needing explicit invalidation.
const classificationCache = new Map();

function cacheKey({ repo, fromRef, toRef, detailed }) {
  return JSON.stringify([repo, fromRef, toRef, Boolean(detailed)]);
}

// Lets the renderer show which phase is running rather than one generic spinner.
function sendStatus(event, payload) {
  if (!event.sender.isDestroyed()) event.sender.send("release-radar:status", payload);
}

ipcMain.handle("release-radar:fetch-changes", async (event, { repo, fromRef, toRef, detailed = false, force = false }) => {
  const githubToken = getSecret("githubToken");
  if (!githubToken) throw new Error("Add a GitHub token in Settings first.");

  const key = cacheKey({ repo, fromRef, toRef, detailed });
  // "Regenerate" from the History tab passes force, so it re-runs the pipeline
  // rather than handing back the cached classification it's trying to redo.
  if (force) classificationCache.delete(key);
  if (classificationCache.has(key)) {
    return { ...classificationCache.get(key), cached: true };
  }

  try {
    sendStatus(event, { phase: "github" });
    const { commits, fileContext, empty, totalCommits, commitsTruncated } =
      await fetchChangeRange({ repo, fromRef, toRef, githubToken });
    if (empty) return { changes: [], empty: true };

    const aiProvider = getSecret("aiProvider") || "anthropic";
    const aiApiKey = getSecret("aiApiKey");
    if (!aiApiKey) throw new Error("Add an AI provider API key in Settings first.");

    sendStatus(event, { phase: "ai", detailed: Boolean(detailed) });
    const { changes, versionBump, diffMeta } = await classifyChanges(
      commits,
      // Diffs reach the prompt only in detailed mode — this is the line that
      // controls token usage, and the whole point of the toggle.
      detailed ? fileContext : null,
      {
        provider: aiProvider,
        apiKey: aiApiKey,
        onRetry: (info) => sendStatus(event, { phase: "retry", ...info })
      }
    );

    const result = { changes, empty: false };

    // GitHub's compare endpoint caps at 250 commits. Say so loudly rather than
    // hand back a changelog that silently covers only part of the range.
    if (commitsTruncated) {
      result.rangeTruncated = { commitsAnalyzed: commits.length, totalCommits };
    }

    // Version suggestion is derived from the classification we already have —
    // no extra AI call. Computed here (not in the renderer) because core/ is
    // CommonJS and Vite would not transform it for the browser bundle.
    // Advisory only: the UI pre-fills it and the user can edit before publishing.
    try {
      result.versionSuggestion = nextVersion(fromRef, changes, versionBump);
    } catch {
      result.versionSuggestion = null; // never block the flow on a suggestion
    }

    // Report what the diffs actually contributed, so "detailed mode" isn't a
    // black box — and so an empty/failed diff payload is visible rather than
    // silently producing toggle-off-quality output. Computed in core/ai.js so
    // the Action reports the same numbers from the same code.
    if (diffMeta) result.diffStats = diffMeta;

    classificationCache.set(key, result);
    return result;
  } finally {
    sendStatus(event, { phase: "idle" });
  }
});

// --- Feature 6a: export the changelog as HTML or plain text ---
//
// These are local outputs, not publish targets: nothing leaves the machine, so
// they deliberately skip the confirm-before-publish guardrail that the remote
// targets go through.

const EXPORTS = {
  html: {
    label: "HTML",
    extension: "html",
    convert: (md, title) => markdownToHtml(md, { fullDocument: true, title })
  },
  text: { label: "Plain text", extension: "txt", convert: (md) => markdownToPlainText(md) },
  markdown: { label: "Markdown", extension: "md", convert: (md) => md }
};

function convertExport({ markdown, format, title }) {
  const spec = EXPORTS[format];
  if (!spec) throw new Error(`Unknown export format: ${format}`);
  if (!markdown) throw new Error("Nothing to export yet — generate release notes first.");
  return { content: spec.convert(markdown, title || "Release notes"), format, extension: spec.extension };
}

ipcMain.handle("release-radar:export", (_event, params) => convertExport(params));

ipcMain.handle("release-radar:export-save", async (event, { markdown, format, title, defaultName }) => {
  const { content, extension } = convertExport({ markdown, format, title });
  const spec = EXPORTS[format];

  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: `Export changelog as ${spec.label}`,
    defaultPath: `${(defaultName || "CHANGELOG").replace(/[^\w.-]+/g, "-")}.${extension}`,
    filters: [
      { name: spec.label, extensions: [extension] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (canceled || !filePath) return { saved: false, canceled: true };
  await fs.writeFile(filePath, content, "utf8");
  return { saved: true, path: filePath };
});

// --- Feature 8: local history of generated changelogs ---

ipcMain.handle("release-radar:history-list", () => listHistory());

ipcMain.handle("release-radar:history-delete", (_event, { id }) => {
  deleteHistoryEntry(id);
  return listHistory();
});

ipcMain.handle("release-radar:history-clear", () => {
  clearHistory();
  return [];
});

// --- Feature 1: visual commit picker ---

ipcMain.handle("release-radar:list-commits", async (_event, { repo, branch, page }) => {
  const githubToken = getSecret("githubToken");
  if (!githubToken) throw new Error("Add a GitHub token in Settings first.");
  return listCommits({ repo, branch, page, githubToken });
});

// --- Feature 2: auto-detect latest release / default branch ---

ipcMain.handle("release-radar:repo-defaults", async (_event, { repo }) => {
  const githubToken = getSecret("githubToken");
  if (!githubToken) throw new Error("Add a GitHub token in Settings first.");
  return getRepoDefaults({ repo, githubToken });
});

// --- Step 2: format + optionally publish ---

ipcMain.handle("release-radar:publish", async (event, { repo, range, changes, markdown: reviewedMarkdown, publishTarget, confirmed, version, detailed = false }) => {
  const aiProvider = getSecret("aiProvider") || "anthropic";
  const aiApiKey = getSecret("aiApiKey");
  if (!aiApiKey) throw new Error("Add an AI provider API key in Settings first.");

  // On confirm, publish exactly what the user reviewed — don't regenerate,
  // since a second AI call could produce different text than what was approved.
  let markdown = reviewedMarkdown;
  if (!(confirmed && reviewedMarkdown)) {
    sendStatus(event, { phase: "format" });
    markdown = await formatReleaseNotes(changes, repo, range, {
      provider: aiProvider,
      apiKey: aiApiKey,
      onRetry: (info) => sendStatus(event, { phase: "retry", ...info })
    });
    sendStatus(event, { phase: "idle" });

    // Feature 8: every generated changelog is saved locally, so closing the
    // app no longer throws away work you already paid API calls for. Saved on
    // generation rather than on publish — most runs never get published.
    addHistoryEntry({ repo, range, markdown, detailed });
  }

  if (publishTarget === "markdown-only") {
    return { markdown, published: false };
  }

  // Guardrail: never publish without explicit confirmation from the UI.
  if (!confirmed) {
    return { markdown, published: false, needsConfirm: true };
  }

  if (publishTarget === "github-release") {
    const githubToken = getSecret("githubToken");
    if (!githubToken) throw new Error("Add a GitHub token in Settings first.");
    const url = await publishGithubRelease({ repo, range, markdown, githubToken, version });
    return { markdown, published: true, publishedUrl: url };
  }

  if (publishTarget === "slack") {
    const webhookUrl = getSecret("slackWebhookUrl");
    if (!webhookUrl) throw new Error("Add a Slack webhook URL in Settings first.");
    await postToSlack({ markdown, webhookUrl });
    return { markdown, published: true };
  }

  if (publishTarget === "pull-request") {
    const githubToken = getSecret("githubToken");
    if (!githubToken) throw new Error("Add a GitHub token in Settings first.");
    const url = await openChangelogPullRequest({ repo, range, markdown, version, githubToken });
    return { markdown, published: true, publishedUrl: url };
  }

  throw new Error(`Unknown publish target: ${publishTarget}`);
});
