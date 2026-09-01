const { openChangelogPullRequest, sanitizeBranchSegment } = require("../core/publish.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

console.log("-- sanitizeBranchSegment --");
check("spaces -> dashes", sanitizeBranchSegment("v1.5.0 final") === "v1.5.0-final", sanitizeBranchSegment("v1.5.0 final"));
check("empty -> update", sanitizeBranchSegment("") === "update");
check("slashes stripped", sanitizeBranchSegment("v1/2") === "v1-2", sanitizeBranchSegment("v1/2"));
check("null -> update", sanitizeBranchSegment(null) === "update");

async function runFlow({ changelogExists }) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });

    if (url.endsWith("/repos/acme/widgets")) {
      return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) };
    }
    if (url.includes("/git/ref/heads/main")) {
      return { ok: true, status: 200, json: async () => ({ object: { sha: "base-sha-123" } }) };
    }
    if (url.includes("/git/refs") && opts.method === "POST") {
      return { ok: true, status: 201, json: async () => ({ ref: "refs/heads/x" }) };
    }
    if (url.includes("/contents/CHANGELOG.md") && (!opts.method || opts.method === "GET")) {
      if (changelogExists) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ sha: "existing-file-sha", content: Buffer.from("# Changelog\n\n## old entry\n").toString("base64") })
        };
      }
      return { ok: false, status: 404, text: async () => "Not Found" };
    }
    if (url.includes("/contents/CHANGELOG.md") && opts.method === "PUT") {
      return { ok: true, status: 200, json: async () => ({ content: {} }) };
    }
    if (url.includes("/pulls") && opts.method === "POST") {
      return { ok: true, status: 201, json: async () => ({ html_url: "https://github.com/acme/widgets/pull/42" }) };
    }
    throw new Error(`Unhandled URL in test: ${url}`);
  };

  const url = await openChangelogPullRequest({
    repo: "acme/widgets",
    range: "v1.0.0...v1.1.0",
    markdown: "## acme/widgets — v1.0.0...v1.1.0\n\n### Features\n- did a thing",
    version: "v1.1.0",
    githubToken: "fake-token"
  });

  return { url, calls };
}

(async () => {
  console.log("\n-- fresh CHANGELOG.md (doesn't exist yet) --");
  const fresh = await runFlow({ changelogExists: false });
  check("returns PR url", fresh.url === "https://github.com/acme/widgets/pull/42");
  const createBranchCall = fresh.calls.find((c) => c.url.includes("/git/refs") && c.method === "POST");
  check("branch created off base sha", createBranchCall.body.sha === "base-sha-123");
  check("branch name includes sanitized version", /^refs\/heads\/release-notes\/v1\.1\.0-/.test(createBranchCall.body.ref), createBranchCall.body.ref);
  const putCall = fresh.calls.find((c) => c.url.includes("/contents/CHANGELOG.md") && c.method === "PUT");
  const freshContent = Buffer.from(putCall.body.content, "base64").toString("utf8");
  check("fresh file gets a # Changelog header", freshContent.startsWith("# Changelog\n\n"), freshContent);
  check("fresh file includes markdown", freshContent.includes("did a thing"));
  check("no sha sent when file is new", putCall.body.sha === undefined);
  const prCall = fresh.calls.find((c) => c.url.includes("/pulls"));
  check("PR base is default branch", prCall.body.base === "main");
  check("PR body is the markdown", prCall.body.body.includes("did a thing"));

  console.log("\n-- existing CHANGELOG.md (should prepend) --");
  const existing = await runFlow({ changelogExists: true });
  const putCall2 = existing.calls.find((c) => c.url.includes("/contents/CHANGELOG.md") && c.method === "PUT");
  const mergedContent = Buffer.from(putCall2.body.content, "base64").toString("utf8");
  check("new section comes first", mergedContent.indexOf("did a thing") < mergedContent.indexOf("old entry"));
  check("old content preserved", mergedContent.includes("## old entry"));
  check("existing sha sent (update, not overwrite-blind)", putCall2.body.sha === "existing-file-sha");

  console.log("\n-- release tag comes from the confirmed version --");
  {
    const { publishGithubRelease } = require("../core/publish.js");
    let body = null;
    global.fetch = async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 201, json: async () => ({ html_url: "u" }) };
    };
    await publishGithubRelease({ repo: "a/b", range: "v1.0.0...main", markdown: "md", githubToken: "t", version: "v1.5.0" });
    check("tag_name uses the confirmed version, not the range end", body.tag_name === "v1.5.0", body.tag_name);
    check("release name matches", body.name === "v1.5.0");
    check("still a draft", body.draft === true);

    await publishGithubRelease({ repo: "a/b", range: "v1.0.0...main", markdown: "md", githubToken: "t" });
    check("falls back to range end when no version given", body.tag_name === "main", body.tag_name);
    await publishGithubRelease({ repo: "a/b", range: "v1.0.0...main", markdown: "md", githubToken: "t", version: "   " });
    check("blank version falls back too", body.tag_name === "main", body.tag_name);
  }

  console.log("\n-- PR body may differ from the committed changelog --");
  {
    const calls = [];
    global.fetch = async (url, opts = {}) => {
      calls.push({ url, method: opts.method || "GET", body: opts.body ? JSON.parse(opts.body) : null });
      if (url.endsWith("/repos/acme/widgets")) return { ok: true, status: 200, json: async () => ({ default_branch: "main" }) };
      if (url.includes("/git/ref/heads/main")) return { ok: true, status: 200, json: async () => ({ object: { sha: "s" } }) };
      if (url.includes("/git/refs")) return { ok: true, status: 201, json: async () => ({}) };
      if (url.includes("/contents/CHANGELOG.md")) {
        if (opts.method === "PUT") return { ok: true, status: 200, json: async () => ({}) };
        return { ok: false, status: 404, text: async () => "nf" };
      }
      if (url.includes("/pulls")) return { ok: true, status: 201, json: async () => ({ html_url: "pr" }) };
      throw new Error("unhandled " + url);
    };
    await openChangelogPullRequest({
      repo: "acme/widgets", range: "v1.0.0...v1.1.0",
      markdown: "## notes\n- a change",
      prBody: "**Suggested next version: v1.1.0**\n\n---\n\n## notes\n- a change",
      version: "v1.1.0", githubToken: "t"
    });
    const put = calls.find((c) => c.url.includes("/contents/CHANGELOG.md") && c.method === "PUT");
    const fileText = Buffer.from(put.body.content, "base64").toString("utf8");
    const pr = calls.find((c) => c.url.includes("/pulls"));
    check("CHANGELOG.md excludes the version annotation", !/Suggested next version/.test(fileText), fileText.slice(0, 80));
    check("CHANGELOG.md keeps the changelog text", /- a change/.test(fileText));
    check("PR body includes the version annotation", /Suggested next version: v1\.1\.0/.test(pr.body.body));
  }


  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
