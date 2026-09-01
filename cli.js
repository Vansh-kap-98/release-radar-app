#!/usr/bin/env node

// Headless entrypoint: the same pipeline as the desktop app and the Action,
// driven from a terminal.
//
// Like action/index.js this is deliberately dependency-free — no arg parser,
// no chalk — so `npx github:Vansh-kap-98/release-radar-app` works without
// pulling a dependency tree, and so `core/`'s zero-dependency rule holds all
// the way out to the edge. See CONTRIBUTING.md.
//
// Contract: the changelog markdown is the ONLY thing on stdout. Every
// diagnostic goes to stderr, so `node cli.js --repo o/n > CHANGELOG.md`
// produces a clean file and you still see progress in the terminal.

const {
  fetchChangeRange,
  getRepoDefaults,
  findPreviousTag,
  classifyChanges,
  formatReleaseNotes,
  nextVersion,
  openChangelogPullRequest,
  publishGithubRelease,
  markdownToHtml,
  markdownToPlainText,
  DEFAULT_API_BASE_URL
} = require("./core");

const PROVIDERS = ["anthropic", "openai", "groq", "google"];
const PUBLISH_TARGETS = ["markdown-only", "github-release", "pull-request"];
const FORMATS = ["markdown", "html", "text"];

// Per-provider conventional env var, checked after the generic one. Saves
// people from re-exporting a key they already have set for something else.
const PROVIDER_KEY_ENV = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  groq: ["GROQ_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"]
};

const HELP = `release-radar — turn a GitHub commit range into a categorized changelog.

Usage:
  node cli.js --repo <owner/name> [options]
  npx github:Vansh-kap-98/release-radar-app --repo <owner/name> [options]

Required:
  --repo <owner/name>       Repository to read. Defaults to $GITHUB_REPOSITORY.

Range (both optional):
  --from <ref>              Start of the range. Defaults to the latest release
                            tag, or the tag before --to when --to is a tag.
  --to <ref>                End of the range. Defaults to the default branch.

AI:
  --provider <name>         ${PROVIDERS.join(" | ")}  (default: anthropic)
  --ai-key <key>            Prefer the environment variable — a flag value
                            lands in your shell history and the process list.
  --detailed                Send file diffs to the AI so vague commit messages
                            still produce accurate entries. Adds roughly
                            10-20k input tokens per run. Off by default.

Output:
  --format <name>           ${FORMATS.join(" | ")}  (default: markdown)
  --json                    Emit a JSON object (markdown, changes, version,
                            diffStats) instead of just the notes.
  --quiet                   Suppress progress output on stderr.

Publishing (nothing is written back unless you ask):
  --publish <target>        ${PUBLISH_TARGETS.join(" | ")}
                            (default: markdown-only — writes nothing)
  --version <tag>           Version label for the release/PR. Defaults to the
                            suggested next version.

GitHub:
  --token <token>           Prefer $GITHUB_TOKEN / $GH_TOKEN.
  --api-base-url <url>      For GitHub Enterprise Server, e.g.
                            https://ghe.example.com/api/v3
                            (default: ${DEFAULT_API_BASE_URL})

Other:
  -h, --help                Show this help.

Environment:
  GITHUB_TOKEN / GH_TOKEN         GitHub token
  RELEASE_RADAR_AI_KEY            AI key for any provider
  ANTHROPIC_API_KEY / OPENAI_API_KEY / GROQ_API_KEY / GOOGLE_API_KEY
  GITHUB_API_BASE_URL             GitHub Enterprise API root
  GITHUB_REPOSITORY               Default for --repo

Options may also be supplied as a JSON object on stdin, using the same names
without the leading dashes. Flags win over stdin; stdin wins over environment:

  echo '{"repo":"acme/app","detailed":true}' | node cli.js

Examples:
  node cli.js --repo acme/app > CHANGELOG.md
  node cli.js --repo acme/app --from v1.2.0 --to main --detailed
  node cli.js --repo acme/app --publish pull-request
`;

/* --------------------------------- plumbing -------------------------------- */

const BOOLEAN_FLAGS = new Set(["detailed", "json", "quiet", "help"]);

// Minimal parser: --key value, --key=value, and the boolean flags above.
// Unknown flags are an error rather than being ignored, so a typo like
// --detaild fails loudly instead of quietly producing cheap-mode output.
function parseArgs(argv) {
  const known = new Set([
    ...BOOLEAN_FLAGS,
    "repo",
    "from",
    "to",
    "provider",
    "ai-key",
    "format",
    "publish",
    "version",
    "token",
    "api-base-url"
  ]);

  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "-h") {
      out.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}". Run with --help for usage.`);
    }

    const body = arg.slice(2);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);

    if (!known.has(name)) {
      throw new Error(`Unknown option "--${name}". Run with --help for usage.`);
    }

    if (BOOLEAN_FLAGS.has(name)) {
      out[name] = eq === -1 ? true : body.slice(eq + 1) !== "false";
      continue;
    }

    const value = eq === -1 ? argv[++i] : body.slice(eq + 1);
    if (value === undefined) throw new Error(`--${name} needs a value.`);
    out[name] = value;
  }
  return out;
}

function readStdin() {
  // Only read when stdin is actually piped. Checking isTTY avoids hanging
  // forever on an interactive terminal that will never send EOF.
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return "";
}

function oneOf(label, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`Invalid --${label} "${value}". Expected one of: ${allowed.join(", ")}.`);
  }
  return value;
}

/* ----------------------------------- run ----------------------------------- */

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const raw = await readStdin();
  let piped = {};
  if (raw.trim()) {
    try {
      piped = JSON.parse(raw);
    } catch {
      throw new Error("stdin was not valid JSON. Expected an object of options.");
    }
    if (!piped || typeof piped !== "object" || Array.isArray(piped)) {
      throw new Error("stdin JSON must be an object of options, e.g. {\"repo\":\"acme/app\"}.");
    }
  }

  const env = process.env;
  const quiet = Boolean(flags.quiet ?? piped.quiet);
  const note = (message) => {
    if (!quiet) process.stderr.write(`${message}\n`);
  };

  const repo = pick(flags.repo, piped.repo, env.GITHUB_REPOSITORY);
  if (!repo) throw new Error("--repo is required (or set GITHUB_REPOSITORY).");
  if (!repo.includes("/")) throw new Error(`Invalid --repo "${repo}". Expected "owner/name".`);

  const githubToken = pick(flags.token, piped.token, env.GITHUB_TOKEN, env.GH_TOKEN);
  if (!githubToken) {
    throw new Error("A GitHub token is required. Set GITHUB_TOKEN or pass --token.");
  }

  const provider = oneOf(
    "provider",
    pick(flags.provider, piped.provider, env.RELEASE_RADAR_AI_PROVIDER, "anthropic"),
    PROVIDERS
  );

  const apiKey = pick(
    flags["ai-key"],
    piped["ai-key"],
    piped.aiKey,
    env.RELEASE_RADAR_AI_KEY,
    ...(PROVIDER_KEY_ENV[provider] || []).map((name) => env[name])
  );
  if (!apiKey) {
    throw new Error(
      `An AI API key is required for ${provider}. Set RELEASE_RADAR_AI_KEY or ` +
        `${(PROVIDER_KEY_ENV[provider] || ["RELEASE_RADAR_AI_KEY"])[0]}, or pass --ai-key.`
    );
  }

  const apiBaseUrl = pick(
    flags["api-base-url"],
    piped["api-base-url"],
    piped.apiBaseUrl,
    env.GITHUB_API_BASE_URL
  );
  const detailed = Boolean(flags.detailed ?? piped.detailed);
  const asJson = Boolean(flags.json ?? piped.json);
  const format = oneOf("format", pick(flags.format, piped.format, "markdown"), FORMATS);
  const publishTarget = oneOf(
    "publish",
    pick(flags.publish, piped.publish, "markdown-only"),
    PUBLISH_TARGETS
  );

  // Resolve the range. Same defaulting the Action uses: if --to names a tag we
  // compare against the tag before it, otherwise "since the latest release".
  let toRef = pick(flags.to, piped.to);
  let fromRef = pick(flags.from, piped.from);

  if (!toRef || !fromRef) {
    const defaults = await getRepoDefaults({ repo, githubToken, apiBaseUrl });
    if (!toRef) toRef = defaults.defaultBranch;
    if (!fromRef) {
      fromRef = (await findPreviousTag({ repo, tag: toRef, githubToken, apiBaseUrl })) || defaults.latestTag;
      if (!fromRef) {
        throw new Error(
          "No tags or releases found, so there is nothing to compare against. Pass --from explicitly."
        );
      }
    }
  }

  const range = `${fromRef}...${toRef}`;
  note(`Comparing ${range} in ${repo}`);

  const { commits, fileContext, empty, totalCommits, commitsTruncated } = await fetchChangeRange({
    repo,
    fromRef,
    toRef,
    githubToken,
    apiBaseUrl
  });

  if (empty) {
    note(`No commits between ${fromRef} and ${toRef}. Nothing to do.`);
    if (asJson) process.stdout.write(`${JSON.stringify({ skipped: true, range, repo }, null, 2)}\n`);
    return 0;
  }

  if (commitsTruncated) {
    // stderr, not stdout: a warning must never end up inside a redirected
    // CHANGELOG.md. Worth shouting about — a partial changelog looks complete.
    process.stderr.write(
      `warning: only the ${commits.length} most recent of ${totalCommits} commits were analyzed — ` +
        "GitHub's compare API caps a range at 250. Split the range into smaller releases.\n"
    );
  }

  note(`Found ${commits.length} commit(s). Classifying with ${provider}${detailed ? " (detailed)" : ""}...`);

  const onRetry = ({ provider: p, attempt, maxRetries, waitMs }) =>
    note(`Rate limited on ${p}; retry ${attempt}/${maxRetries} in ${Math.round(waitMs / 1000)}s`);

  const { changes, versionBump, diffMeta } = await classifyChanges(
    commits,
    detailed ? fileContext : null,
    { provider, apiKey, onRetry }
  );

  if (diffMeta) {
    note(
      `Detailed analysis: sent ${diffMeta.filesIncluded} file(s), ` +
        `${diffMeta.totalDiffChars} characters of diff` +
        (diffMeta.filesOmitted ? ` (${diffMeta.filesOmitted} omitted)` : "")
    );
  }

  const markdown = await formatReleaseNotes(changes, repo, range, { provider, apiKey, onRetry });

  const suggestion = nextVersion(fromRef, changes, versionBump);
  if (suggestion.suggested) {
    note(`Suggested next version: ${suggestion.suggested} (${suggestion.bump}) — ${suggestion.reasoning}`);
  } else {
    note(`No version suggestion: ${suggestion.reasoning}`);
  }

  const version = pick(flags.version, piped.version, suggestion.suggested);

  let publishedUrl = "";
  if (publishTarget === "github-release") {
    publishedUrl = await publishGithubRelease({
      repo,
      range,
      markdown,
      githubToken,
      version,
      apiBaseUrl
    });
    note(`Created draft release: ${publishedUrl}`);
  } else if (publishTarget === "pull-request") {
    const prBody = suggestion.suggested
      ? `**Suggested next version: ${suggestion.suggested}** (${suggestion.bump} bump)\n\n_${suggestion.reasoning}_\n\n---\n\n${markdown}`
      : markdown;
    publishedUrl = await openChangelogPullRequest({
      repo,
      range,
      markdown,
      prBody,
      version,
      githubToken,
      apiBaseUrl
    });
    note(`Opened pull request: ${publishedUrl}`);
  }

  if (asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          repo,
          range,
          markdown,
          changes,
          detailed,
          versionSuggestion: suggestion,
          ...(diffMeta ? { diffStats: diffMeta } : {}),
          ...(commitsTruncated ? { rangeTruncated: { commitsAnalyzed: commits.length, totalCommits } } : {}),
          ...(publishedUrl ? { publishedUrl } : {})
        },
        null,
        2
      )}\n`
    );
    return 0;
  }

  const rendered =
    format === "html"
      ? markdownToHtml(markdown, { fullDocument: true, title: `Release notes ${version || range}` })
      : format === "text"
        ? markdownToPlainText(markdown)
        : markdown;

  process.stdout.write(rendered.endsWith("\n") ? rendered : `${rendered}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((err) => {
    process.stderr.write(`error: ${err?.message || err}\n`);
    process.exitCode = 1;
  });
