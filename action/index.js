// Entrypoint for the companion GitHub Action.
//
// Deliberately dependency-free: it talks to the Actions runner through the
// documented environment protocol rather than @actions/core, so the action
// needs no `npm install` step and no bundling — GitHub can run these files
// exactly as committed. The pipeline itself is the same ../core used by the
// desktop app.

const fs = require("fs");
const {
  fetchChangeRange,
  findPreviousTag,
  getRepoDefaults,
  classifyChanges,
  formatReleaseNotes,
  openChangelogPullRequest,
  publishGithubRelease,
  nextVersion
} = require("../core");

function getInput(name, fallback = "") {
  // The runner exposes `with:` values as INPUT_<NAME>, uppercased, spaces->_.
  const value = process.env[`INPUT_${name.toUpperCase().replace(/[- ]/g, "_")}`];
  return (value ?? "").trim() || fallback;
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  // Heredoc form so multi-line markdown survives intact.
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`;
  fs.appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function log(message) {
  process.stdout.write(`${message}\n`);
}

function fail(message) {
  process.stdout.write(`::error::${message}\n`);
  process.exitCode = 1;
}

function summarize(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file && markdown) fs.appendFileSync(file, `${markdown}\n`);
}

async function run() {
  const githubToken = getInput("github-token");
  const aiApiKey = getInput("ai-api-key");
  const provider = getInput("ai-provider", "anthropic");
  const detailed = getInput("detailed", "false").toLowerCase() === "true";
  const publishTarget = getInput("publish-target", "pull-request");

  if (!githubToken) return fail("github-token is required.");
  if (!aiApiKey) return fail("ai-api-key is required. Add it as a repository secret.");

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) return fail("GITHUB_REPOSITORY is not set — this must run inside GitHub Actions.");

  // Work out the range. On a tag push we default to "since the previous tag",
  // which is the whole point of running this in CI.
  const ref = process.env.GITHUB_REF || "";
  const pushedTag = ref.startsWith("refs/tags/") ? ref.slice("refs/tags/".length) : null;

  let toRef = getInput("to-ref");
  let fromRef = getInput("from-ref");

  if (!toRef) {
    toRef = pushedTag || (await getRepoDefaults({ repo, githubToken })).defaultBranch;
  }

  if (!fromRef) {
    if (pushedTag) {
      fromRef = await findPreviousTag({ repo, tag: pushedTag, githubToken });
      if (!fromRef) {
        log("No previous tag found — nothing to compare against. Skipping.");
        setOutput("skipped", "true");
        return;
      }
    } else {
      const { latestTag } = await getRepoDefaults({ repo, githubToken });
      if (!latestTag) {
        log("No tags or releases found — nothing to compare against. Skipping.");
        setOutput("skipped", "true");
        return;
      }
      fromRef = latestTag;
    }
  }

  const range = `${fromRef}...${toRef}`;
  log(`Comparing ${range} in ${repo}`);

  const { commits, fileContext, empty } = await fetchChangeRange({ repo, fromRef, toRef, githubToken });
  if (empty) {
    log(`No commits between ${fromRef} and ${toRef}. Skipping.`);
    setOutput("skipped", "true");
    return;
  }
  log(`Found ${commits.length} commit(s). Classifying with ${provider}${detailed ? " (detailed)" : ""}...`);

  const changes = await classifyChanges(commits, detailed ? fileContext : null, {
    provider,
    apiKey: aiApiKey,
    onRetry: ({ provider: p, attempt, maxRetries, waitMs }) =>
      log(`Rate limited on ${p}; retry ${attempt}/${maxRetries} in ${Math.round(waitMs / 1000)}s`)
  });

  const markdown = await formatReleaseNotes(changes, repo, range, {
    provider,
    apiKey: aiApiKey,
    onRetry: ({ provider: p, attempt, maxRetries, waitMs }) =>
      log(`Rate limited on ${p}; retry ${attempt}/${maxRetries} in ${Math.round(waitMs / 1000)}s`)
  });

  setOutput("markdown", markdown);
  setOutput("skipped", "false");
  summarize(markdown);

  // Same suggestion logic as the desktop app (core/semver.js) — derived from
  // the classification, no extra AI call. Advisory: it annotates the PR, it
  // does not tag anything.
  const suggestion = nextVersion(fromRef, changes);
  if (suggestion.suggested) {
    log(`Suggested next version: ${suggestion.suggested} (${suggestion.bump}) — ${suggestion.reasoning}`);
    setOutput("suggested-version", suggestion.suggested);
    setOutput("suggested-bump", suggestion.bump);
  } else {
    log(`No version suggestion: ${suggestion.reasoning}`);
  }

  const version = getInput("version", pushedTag || "");

  if (publishTarget === "markdown-only") {
    log("publish-target is markdown-only — not writing anything back to the repo.");
    return;
  }

  if (publishTarget === "github-release") {
    const url = await publishGithubRelease({
      repo,
      range,
      markdown,
      githubToken,
      version: version || suggestion.suggested || ""
    });
    log(`Created draft release: ${url}`);
    setOutput("published-url", url);
    return;
  }

  if (publishTarget === "pull-request") {
    // Lead the PR body with the suggestion so a reviewer sees it before the notes.
    const body = suggestion.suggested
      ? `**Suggested next version: ${suggestion.suggested}** (${suggestion.bump} bump)

_${suggestion.reasoning}_

---

${markdown}`
      : markdown;
    const url = await openChangelogPullRequest({
      repo,
      range,
      markdown,        // committed to CHANGELOG.md — changelog text only
      prBody: body,    // PR description — changelog plus the version suggestion
      version: version || suggestion.suggested || "",
      githubToken
    });
    log(`Opened pull request: ${url}`);
    setOutput("published-url", url);
    return;
  }

  fail(`Unknown publish-target: ${publishTarget}`);
}

run().catch((err) => fail(err.message));
