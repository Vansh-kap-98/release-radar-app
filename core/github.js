// Same logic as the original Lamatic codeNode script, just as a plain
// Node function now — no flow runtime involved. Electron ships with a
// modern enough Node that global fetch() is available.

function authHeaders(githubToken) {
  return {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function assertValidRepo(repo) {
  if (!repo || !repo.includes("/")) {
    throw new Error(`Invalid repo "${repo}". Expected "owner/name".`);
  }
}

// --- Diff-aware changelog support ---------------------------------------
//
// The Compare API already returns a `files` array with per-file unified
// diffs; we just weren't reading it. Raw patches can be enormous (think a
// regenerated lockfile), so everything below exists to get the diff down to
// a bounded, useful payload before it reaches the AI.

const MAX_PATCH_CHARS = 3000;
const MAX_PATCH_LINES = 200;
const MAX_FILES = 30;
// Hard ceiling across all patches combined, so the payload stays bounded
// no matter how large the underlying diff is.
const TOTAL_PATCH_BUDGET = 60000;
// GitHub's Compare API returns at most 300 files per response.
const GITHUB_FILE_CAP = 300;

// Lockfiles, build output and vendored code are almost always the largest
// diffs in a range and the least informative. Ranking purely by change count
// lets them crowd real source out of the payload, so they are listed by name
// (nothing is hidden from the model) but never spend patch budget.
const GENERATED_PATTERNS = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lock(b)?|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/i,
  /(^|\/)(dist|build|out|coverage|node_modules|vendor|__snapshots__)\//i,
  /\.min\.(js|css)$/i,
  /\.(map|lock)$/i,
  /(^|\/)__generated__\//i,
  /\.(pb|generated)\.(go|ts|js)$/i
];

function isGeneratedFile(filename) {
  return GENERATED_PATTERNS.some((re) => re.test(filename || ""));
}

// Truncates on hunk boundaries where possible. A diff cut at an arbitrary
// character offset ends mid-line inside a hunk, which reads as noise; whole
// hunks stay interpretable, and several small hunks from across a file say
// more than the first 3000 characters of its opening hunk.
function truncatePatch(patch, charCap = MAX_PATCH_CHARS) {
  const lines = patch.split("\n");
  if (patch.length <= charCap && lines.length <= MAX_PATCH_LINES) return patch;

  // Split into hunks, keeping any preamble before the first @@ header.
  const hunks = [];
  let current = [];
  for (const line of lines) {
    if (line.startsWith("@@") && current.length) {
      hunks.push(current);
      current = [];
    }
    current.push(line);
  }
  if (current.length) hunks.push(current);

  const kept = [];
  let used = 0;
  let keptLines = 0;
  for (const hunk of hunks) {
    const text = hunk.join("\n");
    if (used + text.length > charCap || keptLines + hunk.length > MAX_PATCH_LINES) break;
    kept.push(text);
    used += text.length + 1;
    keptLines += hunk.length;
  }

  // A single hunk bigger than the whole budget still has to be cut somewhere;
  // fall back to a line-boundary cut so no line is left half-written.
  if (kept.length === 0) {
    const slice = [];
    let n = 0;
    for (const line of lines) {
      if (n + line.length > charCap || slice.length >= MAX_PATCH_LINES) break;
      slice.push(line);
      n += line.length + 1;
    }
    kept.push(slice.join("\n"));
    keptLines = slice.length;
  }

  const omittedLines = lines.length - keptLines;
  let text = kept.join("\n");
  if (omittedLines > 0) text += `\n... (diff truncated, ${omittedLines} more lines)`;
  return text;
}

// Chooses which files' diffs the AI actually sees. Ranking purely by change
// count lets lockfiles and build output win every time, so generated files are
// listed by name but spend no patch budget, and real source is ranked ahead of
// them regardless of size.
function summarizeFiles(rawFiles) {
  const all = rawFiles ?? [];
  const responseCapped = all.length >= GITHUB_FILE_CAP;

  const byChanges = (a, b) => (b.changes ?? 0) - (a.changes ?? 0);
  const source = all.filter((f) => !isGeneratedFile(f.filename)).sort(byChanges);
  const generated = all.filter((f) => isGeneratedFile(f.filename)).sort(byChanges);

  // Source first, so a huge lockfile can never displace a real code change.
  const selected = [...source, ...generated].slice(0, MAX_FILES);
  const omittedFileCount = all.length - selected.length;

  let budget = TOTAL_PATCH_BUDGET;
  const patchable = selected.filter((f) => f.patch && !isGeneratedFile(f.filename)).length;
  // Spread the budget across the files that will actually use it, so one large
  // file cannot eat everything and starve the rest.
  const perFileCap = patchable > 0
    ? Math.max(800, Math.min(MAX_PATCH_CHARS, Math.floor(TOTAL_PATCH_BUDGET / patchable)))
    : MAX_PATCH_CHARS;

  const files = selected.map((f) => {
    const entry = {
      filename: f.filename,
      status: f.status,
      additions: f.additions ?? 0,
      deletions: f.deletions ?? 0,
      changes: f.changes ?? 0,
      patch: null,
      note: null
    };

    if (f.status === "renamed" && f.previous_filename) {
      entry.note = `renamed ${f.previous_filename} → ${f.filename}`;
    }

    if (isGeneratedFile(f.filename)) {
      entry.generated = true;
      entry.note = entry.note ?? "generated/build output — diff omitted, treat as chore";
      return entry;
    }

    // Binary files, and renames with no content change, arrive with no patch.
    if (!f.patch) {
      entry.note = entry.note ?? `no textual diff available (status: ${f.status})`;
      return entry;
    }

    if (budget <= 0) {
      entry.note = entry.note ?? "diff omitted to stay within the total size budget";
      return entry;
    }

    const patch = truncatePatch(f.patch, Math.min(perFileCap, budget));
    budget -= patch.length;
    entry.patch = patch;
    return entry;
  });

  return { files, omittedFileCount, responseCapped };
}

async function fetchChangeRange({ repo, fromRef, toRef, githubToken }) {
  assertValidRepo(repo);
  if (!fromRef || !toRef) {
    throw new Error("Both fromRef and toRef are required.");
  }

  const url = `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(
    fromRef
  )}...${encodeURIComponent(toRef)}`;

  const res = await fetch(url, { headers: authHeaders(githubToken) });

  if (res.status === 404) {
    throw new Error(
      `Repo or ref not found: ${repo} (${fromRef}...${toRef}). Check spelling and that your token has access.`
    );
  }
  if (res.status === 403) {
    throw new Error("GitHub rate limit hit or token lacks permission.");
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  const commits = (data.commits ?? []).map((c) => ({
    sha: c.sha,
    message: c.commit?.message ?? "",
    author: c.author?.login ?? c.commit?.author?.name ?? "unknown",
    url: c.html_url
  }));

  if (commits.length === 0) {
    return { commits: [], fileContext: null, empty: true };
  }

  // The compare response already carries `files`, so summarizing costs no
  // extra API call. Whether this reaches the AI prompt (and burns tokens) is
  // decided by the caller's "detailed analysis" toggle, not here.
  return { commits, fileContext: summarizeFiles(data.files), empty: false };
}

// Feature 1: visual commit picker. Lists commits on a branch (paginated via
// GitHub's `page` query param), newest first — same order the UI shows them
// in, so "more recent" comparisons can be done via array index.
async function listCommits({ repo, branch, page = 1, githubToken }) {
  assertValidRepo(repo);

  const params = new URLSearchParams({ per_page: "30", page: String(page) });
  if (branch) params.set("sha", branch);

  const res = await fetch(`https://api.github.com/repos/${repo}/commits?${params}`, {
    headers: authHeaders(githubToken)
  });

  if (res.status === 404) {
    throw new Error(`Repo or branch not found: ${repo}${branch ? ` (${branch})` : ""}.`);
  }
  if (res.status === 403) {
    throw new Error("GitHub rate limit hit or token lacks permission.");
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  const linkHeader = res.headers.get("link") || "";
  const hasNextPage = /rel="next"/.test(linkHeader);

  const commits = data.map((c) => ({
    sha: c.sha,
    shortSha: c.sha.slice(0, 7),
    message: c.commit?.message ?? "",
    author: c.author?.login ?? c.commit?.author?.name ?? "unknown",
    date: c.commit?.author?.date ?? null,
    url: c.html_url
  }));

  return { commits, hasNextPage };
}

// Feature 2: auto-detect the default range. Latest release tag (if any) +
// the repo's actual default branch (not a hardcoded "main").
async function getRepoDefaults({ repo, githubToken }) {
  assertValidRepo(repo);

  const [repoRes, releaseRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${repo}`, { headers: authHeaders(githubToken) }),
    fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: authHeaders(githubToken) })
  ]);

  if (repoRes.status === 404) {
    throw new Error(`Repo not found: ${repo}. Check spelling and that your token has access.`);
  }
  if (!repoRes.ok) {
    throw new Error(`GitHub API error: ${repoRes.status} ${repoRes.statusText}`);
  }
  const repoData = await repoRes.json();

  // 404 here just means "no releases yet" — not an error, latestTag stays null.
  let latestTag = null;
  if (releaseRes.status === 404) {
    latestTag = null;
  } else if (!releaseRes.ok) {
    throw new Error(`GitHub API error: ${releaseRes.status} ${releaseRes.statusText}`);
  } else {
    const releaseData = await releaseRes.json();
    latestTag = releaseData.tag_name ?? null;
  }

  return { defaultBranch: repoData.default_branch, latestTag };
}

// Feature 5 (GitHub Action): CI has no UI to pick refs from, so it has to
// derive "what changed since the last release" on its own.
async function listTags({ repo, githubToken, perPage = 100 }) {
  assertValidRepo(repo);

  const res = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=${perPage}`, {
    headers: authHeaders(githubToken)
  });
  if (!res.ok) throw new Error(`GitHub API error listing tags: ${res.status} ${res.statusText}`);

  const data = await res.json();
  return data.map((t) => ({ name: t.name, sha: t.commit?.sha ?? null }));
}

// Given the tag being released, find the tag immediately before it. Returns
// null when this is the first tag — the caller decides what to do about it,
// since there's no meaningful "previous release" to compare against.
async function findPreviousTag({ repo, tag, githubToken }) {
  const tags = await listTags({ repo, githubToken });
  if (tags.length === 0) return null;

  const index = tags.findIndex((t) => t.name === tag);
  if (index === -1) {
    // The tag isn't in the list (brand new, or beyond the first page).
    // The newest known tag is the best available baseline.
    return tags[0].name === tag ? null : tags[0].name;
  }
  return tags[index + 1]?.name ?? null;
}

module.exports = {
  fetchChangeRange,
  listCommits,
  getRepoDefaults,
  listTags,
  findPreviousTag,
  summarizeFiles,
  truncatePatch
};
