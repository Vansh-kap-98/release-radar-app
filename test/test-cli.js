// End-to-end tests for cli.js.
//
// Runs the real CLI as a child process with a stubbed global fetch injected
// via --require, so the whole pipeline (GitHub reads -> classify -> format ->
// output) is exercised without touching the network. The stdout/stderr split
// is the CLI's actual contract, so it is asserted directly.

const { execFileSync, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

const CLI = path.join(__dirname, "..", "cli.js");

// A preload module that replaces global.fetch with a canned GitHub + AI
// backend. Written to a temp file because --require needs a real path.
const STUB = `
const COMMITS = {
  commits: [
    { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", commit: { message: "feat: add a picker", author: { name: "dana", date: "2026-01-01T00:00:00Z" } }, author: { login: "dana" }, html_url: "https://example/1" },
    { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", commit: { message: "fix: stop crashing", author: { name: "marco", date: "2026-01-02T00:00:00Z" } }, author: { login: "marco" }, html_url: "https://example/2" }
  ],
  total_commits: 2,
  files: [{ filename: "src/app.js", status: "modified", additions: 5, deletions: 1, changes: 6, patch: "@@ -1 +1 @@\\n-a\\n+b" }]
};

const CLASSIFY = JSON.stringify({
  changes: [
    { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", title: "Add a commit picker", category: "feat", scope: "picker" },
    { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", title: "Stop crashing on empty input", category: "fix" }
  ],
  version: { bump: "minor", reasoning: "One new user-facing capability." }
});

const NOTES = "## acme/app — v1.0.0...main\\n\\n### Features\\n- **picker**: Add a commit picker\\n\\n### Fixes\\n- Stop crashing on empty input\\n";

globalThis.__calls = [];

function res(body, status) {
  status = status || 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

global.fetch = async (url, init) => {
  const u = String(url);
  globalThis.__calls.push(u);

  if (u.includes("api.anthropic.com")) {
    const sentSystem = JSON.parse(init.body).system;
    const isFormatter = /release notes formatter/i.test(sentSystem);
    return res({ content: [{ text: isFormatter ? NOTES : CLASSIFY }] });
  }
  if (u.includes("/compare/")) {
    if (process.env.STUB_EMPTY === "1") return res({ commits: [], files: [] });
    return res(COMMITS);
  }
  if (u.includes("/tags?")) return res([{ name: "v1.1.0" }, { name: "v1.0.0" }]);
  if (u.includes("/releases/latest")) return res({ tag_name: "v1.0.0" });
  if (u.includes("/releases")) return res({ html_url: "https://example/releases/tag/v1.1.0" });
  if (/\\/repos\\/[^/]+\\/[^/]+$/.test(u)) return res({ default_branch: "main" });
  if (u.includes("/commits?")) return res(COMMITS.commits);
  return res({}, 404);
};
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rr-cli-"));
const stubPath = path.join(tmp, "stub.js");
fs.writeFileSync(stubPath, STUB, "utf8");

// Runs the CLI with the stub preloaded. Returns { stdout, stderr, code }.
// stdin is closed immediately unless `input` is given, so the CLI's isTTY
// check and stdin parsing are both exercised for real.
function runCli(args, { input = "", env = {} } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      ["--require", stubPath, CLI, ...args],
      {
        env: {
          ...process.env,
          GITHUB_TOKEN: "gh-token",
          RELEASE_RADAR_AI_KEY: "ai-key",
          STUB_EMPTY: "",
          ...env
        },
        encoding: "utf8"
      },
      (err, stdout, stderr) => {
        resolve({ stdout, stderr, code: err ? (err.code ?? 1) : 0 });
      }
    );
    child.stdin.end(input);
  });
}

(async () => {
  console.log("-- --help --");
  {
    const out = execFileSync(process.execPath, [CLI, "--help"], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    check("prints usage", /Usage:/.test(out));
    check("documents --detailed as off by default", /Off by default/.test(out));
    check("documents markdown-only as the publish default", /markdown-only — writes nothing/.test(out));
    check("documents the enterprise base url", /--api-base-url/.test(out));
  }

  console.log("-- default run prints markdown on stdout only --");
  {
    const { stdout, stderr, code } = await runCli(["--repo", "acme/app"]);
    check("exits 0", code === 0, code);
    check("stdout is the changelog", stdout.startsWith("## acme/app"), JSON.stringify(stdout.slice(0, 40)));
    check("stdout has no progress noise", !/Comparing|Found |Suggested/.test(stdout), stdout);
    // --to defaults to the default branch, which is not in the tag list, so
    // findPreviousTag falls back to the newest known tag as the baseline.
    check("progress went to stderr", /Comparing v1\.1\.0\.\.\.main/.test(stderr), stderr);
    check("version suggestion went to stderr", /Suggested next version: v1\.2\.0/.test(stderr), stderr);
    check("stdout ends with a newline", stdout.endsWith("\n"));
  }

  console.log("-- --quiet silences stderr but not stdout --");
  {
    const { stdout, stderr, code } = await runCli(["--repo", "acme/app", "--quiet"]);
    check("exits 0", code === 0, code);
    check("stdout still has the changelog", stdout.includes("### Features"), stdout);
    check("stderr is empty", stderr.trim() === "", stderr);
  }

  console.log("-- nothing is published by default --");
  {
    const { stdout, stderr } = await runCli(["--repo", "acme/app"]);
    check("no release was created", !/Created draft release/.test(stderr), stderr);
    check("no PR was opened", !/Opened pull request/.test(stderr), stderr);
    check("stdout is still just markdown", stdout.trim().startsWith("##"));
  }

  console.log("-- --publish github-release opts in --");
  {
    const { stderr, code } = await runCli(["--repo", "acme/app", "--publish", "github-release"]);
    check("exits 0", code === 0, code);
    check("reports the draft release", /Created draft release: https:\/\/example\/releases/.test(stderr), stderr);
  }

  console.log("-- --detailed changes what is sent --");
  {
    const plain = await runCli(["--repo", "acme/app"]);
    const detailed = await runCli(["--repo", "acme/app", "--detailed"]);
    check("plain run reports no diff stats", !/Detailed analysis/.test(plain.stderr), plain.stderr);
    check("detailed run reports diff stats", /Detailed analysis: sent 1 file/.test(detailed.stderr), detailed.stderr);
    check("both still produce markdown", plain.stdout.includes("###") && detailed.stdout.includes("###"));
  }

  console.log("-- --json --");
  {
    const { stdout, code } = await runCli(["--repo", "acme/app", "--json"]);
    check("exits 0", code === 0, code);
    let parsed = null;
    try { parsed = JSON.parse(stdout); } catch { /* left null */ }
    check("stdout is valid JSON", parsed !== null, stdout.slice(0, 120));
    check("carries the markdown", parsed && typeof parsed.markdown === "string" && parsed.markdown.includes("###"));
    check("carries the classified changes", parsed && parsed.changes.length === 2, parsed && parsed.changes);
    check("carries the version suggestion", parsed && parsed.versionSuggestion.suggested === "v1.2.0", parsed && parsed.versionSuggestion);
    check("records that the AI decided the bump", parsed && parsed.versionSuggestion.decidedBy === "ai", parsed && parsed.versionSuggestion);
    check("reports detailed:false by default", parsed && parsed.detailed === false);
    check("omits diffStats when not detailed", parsed && parsed.diffStats === undefined);
  }

  console.log("-- --format --");
  {
    const html = await runCli(["--repo", "acme/app", "--format", "html"]);
    check("html is a full document", html.stdout.startsWith("<!doctype html>"), html.stdout.slice(0, 40));
    check("html contains the entries", /<li>/.test(html.stdout));

    const text = await runCli(["--repo", "acme/app", "--format", "text"]);
    check("text has no markdown headings", !/^#/m.test(text.stdout), text.stdout);
    check("text keeps the bullets", /^- /m.test(text.stdout), text.stdout);
    check("text shouts the top heading", /ACME\/APP/.test(text.stdout), text.stdout);
  }

  console.log("-- options via stdin --");
  {
    const { stdout, stderr, code } = await runCli([], { input: JSON.stringify({ repo: "acme/app" }) });
    check("exits 0", code === 0, code);
    check("repo came from stdin", /Comparing .* in acme\/app/.test(stderr), stderr);
    check("still prints markdown", stdout.includes("### Features"));
  }

  console.log("-- flags beat stdin --");
  {
    const { stderr } = await runCli(["--repo", "other/repo"], { input: JSON.stringify({ repo: "acme/app" }) });
    check("the flag won", /in other\/repo/.test(stderr), stderr);
  }

  console.log("-- explicit range skips defaulting --");
  {
    const { stderr } = await runCli(["--repo", "acme/app", "--from", "v0.9.0", "--to", "v1.0.0"]);
    check("uses the given range", /Comparing v0\.9\.0\.\.\.v1\.0\.0/.test(stderr), stderr);
  }

  console.log("-- empty range exits cleanly --");
  {
    const { stdout, stderr, code } = await runCli(["--repo", "acme/app"], { env: { STUB_EMPTY: "1" } });
    check("exits 0", code === 0, code);
    check("says there is nothing to do", /Nothing to do/.test(stderr), stderr);
    check("writes nothing to stdout", stdout.trim() === "", stdout);
  }

  console.log("-- error handling --");
  {
    const noRepo = await runCli(["--token", "x"], { env: { GITHUB_REPOSITORY: "" } });
    check("missing repo exits 1", noRepo.code === 1, noRepo.code);
    check("missing repo explains itself", /--repo is required/.test(noRepo.stderr), noRepo.stderr);
    check("missing repo writes nothing to stdout", noRepo.stdout === "", noRepo.stdout);

    const badRepo = await runCli(["--repo", "notaslug"]);
    check("malformed repo exits 1", badRepo.code === 1, badRepo.code);
    check("malformed repo explains itself", /Expected "owner\/name"/.test(badRepo.stderr), badRepo.stderr);

    const noToken = await runCli(["--repo", "acme/app"], { env: { GITHUB_TOKEN: "", GH_TOKEN: "" } });
    check("missing token exits 1", noToken.code === 1, noToken.code);
    check("missing token names the env var", /GITHUB_TOKEN/.test(noToken.stderr), noToken.stderr);

    const noKey = await runCli(["--repo", "acme/app"], { env: { RELEASE_RADAR_AI_KEY: "", ANTHROPIC_API_KEY: "" } });
    check("missing ai key exits 1", noKey.code === 1, noKey.code);
    check("missing ai key names the provider env var", /ANTHROPIC_API_KEY/.test(noKey.stderr), noKey.stderr);

    const typo = await runCli(["--repo", "acme/app", "--detaild"]);
    check("a typo'd flag exits 1 instead of being ignored", typo.code === 1, typo.code);
    check("typo names the option", /Unknown option "--detaild"/.test(typo.stderr), typo.stderr);

    const badTarget = await runCli(["--repo", "acme/app", "--publish", "tweet"]);
    check("unknown publish target exits 1", badTarget.code === 1, badTarget.code);
    check("unknown publish target lists valid ones", /markdown-only/.test(badTarget.stderr), badTarget.stderr);

    const badStdin = await runCli([], { input: "not json" });
    check("malformed stdin exits 1", badStdin.code === 1, badStdin.code);
    check("malformed stdin explains itself", /stdin was not valid JSON/.test(badStdin.stderr), badStdin.stderr);
  }

  console.log("-- provider-specific key env vars --");
  {
    const r = await runCli(["--repo", "acme/app"], {
      env: { RELEASE_RADAR_AI_KEY: "", ANTHROPIC_API_KEY: "from-anthropic-env" }
    });
    check("falls back to ANTHROPIC_API_KEY", r.code === 0, r.stderr);
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
