const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs/promises");
const { getSecret, setSecret, getAll } = require("./lib/store");
// Pipeline logic lives in ../core (no Electron dependency) so the same code
// can run in the desktop app and in the companion GitHub Action.
const { fetchChangeRange, listCommits, getRepoDefaults, webBase } = require("../core/github");
const { classifyChanges, formatReleaseNotes } = require("../core/ai");
const { nextVersion } = require("../core/semver");
const { markdownToHtml, markdownToPlainText } = require("../core/export");
const { publishGithubRelease, postToSlack, openChangelogPullRequest } = require("../core/publish");
const { listHistory, addHistoryEntry, deleteHistoryEntry, clearHistory } = require("./lib/history");

const isDev = process.env.NODE_ENV === "development";

// GitHub Enterprise Server support. Blank/unset resolves to api.github.com
// inside core/, so reading it here changes nothing for existing users.
const githubApiBaseUrl = () => getSecret("githubApiBaseUrl") || "";

// --- "Generate a token" deep link ----------------------------------------
//
// GitHub's classic-PAT creation page accepts `description` and `scopes` query
// params and pre-fills the form from them. That is all it does: there is no
// parameter that returns the generated token to us, so the user still has to
// copy it off GitHub's page and paste it into Settings. (Getting a token back
// programmatically is what OAuth Device Flow is for — a separate mechanism,
// independent of this one.)
//
// Classic rather than fine-grained on purpose: a fine-grained token's
// repository selection is a manual picker with no URL equivalent, so a
// fine-grained link cannot express "all my repositories" and would add a step
// instead of removing one. The classic `repo` scope covers everything the app
// does — reading commits and diffs, creating draft releases, opening changelog
// PRs — in a single scope.
//
// There is deliberately no expiration parameter: classic tokens set expiry
// from a dropdown on the page, and an expiry passed in the URL is silently
// ignored rather than rejected.
const TOKEN_SCOPES = ["repo"];
const TOKEN_DESCRIPTION = "Release Radar";

function tokenCreationUrl() {
  // Honour the configured API host so an Enterprise Server user is sent to
  // their own appliance — a token minted on github.com is useless against
  // GHES. Blank config resolves to https://github.com, unchanged.
  const params = new URLSearchParams({
    description: TOKEN_DESCRIPTION,
    scopes: TOKEN_SCOPES.join(","),
  });
  // URLSearchParams encodes spaces as "+", which is what this endpoint expects:
  // -> description=Release+Radar&scopes=repo
  return `${webBase(githubApiBaseUrl())}/settings/tokens/new?${params.toString()}`;
}

// --- Window chrome ---------------------------------------------------------
//
// The OS-drawn title bar cannot be themed, so on Windows and Linux it is
// removed entirely and redrawn in React (see src/components/rr/TitleBar.jsx).
//
// macOS is deliberately different: "hiddenInset" drops the title strip but
// keeps the native traffic lights, which Mac users expect to be in the usual
// place with the usual behaviour, and which are already theme-neutral. We do
// NOT custom-draw those.
const isMac = process.platform === "darwin";

function frameOptions() {
  if (isMac) return { titleBarStyle: "hiddenInset" };
  return {
    frame: false,
    // Keeps the native WS_THICKFRAME on Windows, which is what Aero Snap,
    // Win+Arrow and the edge resize handles hang off. Dropping the frame
    // without this is where "snapping stopped working" bugs come from.
    thickFrame: true,
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 420,
    // Painted with the light token; the renderer repaints immediately. Without
    // it a frameless window flashes white-on-black while the bundle loads.
    backgroundColor: "#fbfbfc",
    ...frameOptions(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Keep the renderer's maximize/restore icon truthful no matter how the state
  // changed — button, double-click on the drag region, Win+Arrow, or a drag to
  // a screen edge all funnel through these two events.
  const sendMaximizeState = () => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send("window:maximize-changed", win.isMaximized());
    }
  };
  win.on("maximize", sendMaximizeState);
  win.on("unmaximize", sendMaximizeState);

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

// --- Window controls -------------------------------------------------------
//
// With no native frame there is nothing to minimise/maximise/close the window,
// so the renderer's title bar drives it over IPC. Each handler resolves the
// window from the sender rather than a module-level reference, so it stays
// correct if a second window is ever opened.

function senderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.handle("window:minimize", (event) => {
  senderWindow(event)?.minimize();
});

ipcMain.handle("window:toggle-maximize", (event) => {
  const win = senderWindow(event);
  if (!win) return false;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
  return win.isMaximized();
});

ipcMain.handle("window:close", (event) => {
  senderWindow(event)?.close();
});

ipcMain.handle("window:is-maximized", (event) => Boolean(senderWindow(event)?.isMaximized()));

// --- Settings (API keys), stored encrypted on disk via safeStorage ---

ipcMain.handle("settings:get", () => getAll());

ipcMain.handle("settings:set", (_event, { key, value }) => {
  setSecret(key, value);
  return true;
});

// Opens the user's DEFAULT BROWSER (not an in-app window) at the pre-filled
// token form. shell.openExternal hands the URL to the OS.
ipcMain.handle("settings:open-token-creation-url", async () => {
  const url = tokenCreationUrl();

  // Defensive: the host comes from a user-editable setting, and openExternal
  // will happily hand a non-http scheme to the OS. Refuse anything else.
  const protocol = new URL(url).protocol;
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error(`Refusing to open a non-web URL (${protocol}). Check the GitHub API base URL in Settings.`);
  }

  await shell.openExternal(url);
  return { opened: true, url };
});

// --- Step 1: fetch + classify ---

// Session-scoped cache of classification results, keyed by the inputs that
// affect the answer. Changing any input yields a different key, so edits
// naturally bypass the cache without needing explicit invalidation.
const classificationCache = new Map();

// The GitHub host is part of the key: the same owner/name can exist on
// github.com and on an enterprise appliance with entirely different commits.
function cacheKey({ repo, fromRef, toRef, detailed, apiBaseUrl }) {
  return JSON.stringify([repo, fromRef, toRef, Boolean(detailed), apiBaseUrl || ""]);
}

// Lets the renderer show which phase is running rather than one generic spinner.
function sendStatus(event, payload) {
  if (!event.sender.isDestroyed()) event.sender.send("release-radar:status", payload);
}

ipcMain.handle("release-radar:fetch-changes", async (event, { repo, fromRef, toRef, detailed = false, force = false }) => {
  const githubToken = getSecret("githubToken");
  if (!githubToken) throw new Error("Add a GitHub token in Settings first.");

  const apiBaseUrl = githubApiBaseUrl();
  const key = cacheKey({ repo, fromRef, toRef, detailed, apiBaseUrl });
  // "Regenerate" from the History tab passes force, so it re-runs the pipeline
  // rather than handing back the cached classification it's trying to redo.
  if (force) classificationCache.delete(key);
  if (classificationCache.has(key)) {
    return { ...classificationCache.get(key), cached: true };
  }

  try {
    sendStatus(event, { phase: "github" });
    const { commits, fileContext, empty, totalCommits, commitsTruncated } =
      await fetchChangeRange({ repo, fromRef, toRef, githubToken, apiBaseUrl });
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

// --- Export the changelog as HTML or plain text ---
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

// --- Local history of generated changelogs ---

ipcMain.handle("release-radar:history-list", () => listHistory());

ipcMain.handle("release-radar:history-delete", (_event, { id }) => {
  deleteHistoryEntry(id);
  return listHistory();
});

ipcMain.handle("release-radar:history-clear", () => {
  clearHistory();
  return [];
});

// --- Visual commit picker ---

ipcMain.handle("release-radar:list-commits", async (_event, { repo, branch, page }) => {
  const githubToken = getSecret("githubToken");
  if (!githubToken) throw new Error("Add a GitHub token in Settings first.");
  return listCommits({ repo, branch, page, githubToken, apiBaseUrl: githubApiBaseUrl() });
});

// --- Auto-detect latest release / default branch ---

ipcMain.handle("release-radar:repo-defaults", async (_event, { repo }) => {
  const githubToken = getSecret("githubToken");
  if (!githubToken) throw new Error("Add a GitHub token in Settings first.");
  return getRepoDefaults({ repo, githubToken, apiBaseUrl: githubApiBaseUrl() });
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

    // Every generated changelog is saved locally, so closing the
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
    const url = await publishGithubRelease({ repo, range, markdown, githubToken, version, apiBaseUrl: githubApiBaseUrl() });
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
    const url = await openChangelogPullRequest({ repo, range, markdown, version, githubToken, apiBaseUrl: githubApiBaseUrl() });
    return { markdown, published: true, publishedUrl: url };
  }

  throw new Error(`Unknown publish target: ${publishTarget}`);
});
