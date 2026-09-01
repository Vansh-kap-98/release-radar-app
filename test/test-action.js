const fs = require("fs");
const os = require("os");
const path = require("path");
const { findPreviousTag, listTags } = require("../core/github.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

function mkRes({ status = 200, body = {}, headers = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

const TAGS = [{ name: "v1.3.0" }, { name: "v1.2.0" }, { name: "v1.1.0" }];

(async () => {
  console.log("-- getInput uses GitHub's documented INPUT_ naming --");
  {
    // GitHub: "converts input names to uppercase and replaces spaces with _".
    // Hyphens are PRESERVED — the docs' own example is num-octocats ->
    // INPUT_NUM-OCTOCATS. Reading the underscore form instead makes every
    // hyphenated input empty on a real runner.
    const src = fs.readFileSync(require("path").join(__dirname, "..", "action/index.js"), "utf8");
    const m = /function getInput\(name, fallback = ""\) \{([\s\S]*?)\n\}/.exec(src);
    const getInput = new Function("name", "fallback", m[1]);
    process.env["INPUT_GITHUB-TOKEN"] = "hyphen-form";
    delete process.env.INPUT_GITHUB_TOKEN;
    check("reads the hyphen-preserved env var", getInput("github-token", "") === "hyphen-form", getInput("github-token", ""));
    delete process.env["INPUT_GITHUB-TOKEN"];
    check("falls back to the default when unset", getInput("github-token", "fallback") === "fallback");
    process.env["INPUT_AI-PROVIDER"] = "";
    check("blank input falls through to the default", getInput("ai-provider", "anthropic") === "anthropic");
    delete process.env["INPUT_AI-PROVIDER"];
  }


  console.log("\n-- findPreviousTag --");
  global.fetch = async () => mkRes({ body: TAGS });
  check("middle tag -> next older", await findPreviousTag({ repo: "a/b", tag: "v1.2.0", githubToken: "t" }) === "v1.1.0");
  check("newest tag -> second newest", await findPreviousTag({ repo: "a/b", tag: "v1.3.0", githubToken: "t" }) === "v1.2.0");
  check("oldest tag -> null", await findPreviousTag({ repo: "a/b", tag: "v1.1.0", githubToken: "t" }) === null);
  check("unknown tag -> newest known", await findPreviousTag({ repo: "a/b", tag: "v9.9.9", githubToken: "t" }) === "v1.3.0");

  global.fetch = async () => mkRes({ body: [] });
  check("no tags at all -> null", await findPreviousTag({ repo: "a/b", tag: "v1.0.0", githubToken: "t" }) === null);

  global.fetch = async () => mkRes({ body: [{ name: "v1.0.0" }] });
  check("only tag is the pushed one -> null", await findPreviousTag({ repo: "a/b", tag: "v1.0.0", githubToken: "t" }) === null);

  console.log("\n-- action entrypoint (tag push -> PR) --");
  {
    const outFile = path.join(os.tmpdir(), `gh-out-${Date.now()}.txt`);
    fs.writeFileSync(outFile, "");
    const calls = [];
    const prBodies = [];
    const changelogWrites = [];

    global.fetch = async (url, opts = {}) => {
      calls.push(`${opts.method || "GET"} ${url}`);
      if (url.includes("/pulls") && opts.method === "POST") prBodies.push(JSON.parse(opts.body).body);
      if (url.includes("/contents/CHANGELOG.md") && opts.method === "PUT") {
        changelogWrites.push(Buffer.from(JSON.parse(opts.body).content, "base64").toString("utf8"));
      }
      if (url.includes("/tags")) return mkRes({ body: TAGS });
      if (url.includes("/compare/")) {
        return mkRes({ body: { commits: [{ sha: "s1", commit: { message: "wip" } }], files: [] } });
      }
      if (url.includes("api.anthropic.com")) {
        const body = JSON.parse(opts.body);
        const isClassify = body.system.includes("classification");
        return mkRes({ body: { content: [{ text: isClassify ? '[{"sha":"s1","title":"did a thing","category":"feat"}]' : "## notes\n- did a thing" }] } });
      }
      if (url.endsWith("/repos/acme/widgets")) return mkRes({ body: { default_branch: "main" } });
      if (url.includes("/git/ref/heads/")) return mkRes({ body: { object: { sha: "base1" } } });
      if (url.includes("/git/refs")) return mkRes({ status: 201, body: {} });
      if (url.includes("/contents/CHANGELOG.md")) {
        if (opts.method === "PUT") return mkRes({ body: {} });
        return mkRes({ status: 404, body: {} });
      }
      if (url.includes("/pulls")) return mkRes({ status: 201, body: { html_url: "https://github.com/acme/widgets/pull/7" } });
      throw new Error(`Unhandled: ${url}`);
    };

    process.env.GITHUB_REPOSITORY = "acme/widgets";
    process.env.GITHUB_REF = "refs/tags/v1.3.0";
    process.env.GITHUB_OUTPUT = outFile;
    // Deliberately ONLY the hyphen-preserved names GitHub actually sets.
    process.env["INPUT_GITHUB-TOKEN"] = "ghtok";
    process.env["INPUT_AI-API-KEY"] = "aikey";
    process.env["INPUT_AI-PROVIDER"] = "anthropic";
    process.env["INPUT_PUBLISH-TARGET"] = "pull-request";
    delete process.env.INPUT_GITHUB_TOKEN;
    delete process.env.INPUT_AI_API_KEY;
    delete process.env.INPUT_AI_PROVIDER;
    delete process.env.INPUT_PUBLISH_TARGET;

    delete require.cache[require.resolve(require("path").join(__dirname, "..", "action/index.js"))];
    require("../action/index.js");
    await new Promise((r) => setTimeout(r, 150));

    const out = fs.readFileSync(outFile, "utf8");
    check("derived previous tag via /tags", calls.some((c) => c.includes("/tags")), calls.join("\n"));
    check("compared v1.2.0...v1.3.0", calls.some((c) => c.includes("compare/v1.2.0...v1.3.0")), calls.join("\n"));
    check("opened a PR", calls.some((c) => c.startsWith("POST") && c.includes("/pulls")));
    check("wrote markdown output", out.includes("markdown<<") && out.includes("did a thing"), out);
    check("wrote published-url output", out.includes("https://github.com/acme/widgets/pull/7"), out);
    check("skipped=false", /skipped<<\S+\nfalse\n/.test(out), out);
    check("exit code not failed", process.exitCode !== 1, `exitCode=${process.exitCode}`);

    // Version suggestion: v1.2.0 -> v1.3.0 range, one feat entry -> minor bump
    check("suggested-version written to outputs", /suggested-version<<\S+\nv1\.3\.0\n/.test(out), out);
    check("suggested-bump written to outputs", /suggested-bump<<\S+\nminor\n/.test(out), out);
    check("PR body leads with the suggestion", /Suggested next version: v1\.3\.0/.test(prBodies[0] || ""), prBodies[0]);
    check("CHANGELOG.md content excludes the suggestion", !/Suggested next version/.test(changelogWrites[0] || ""), changelogWrites[0]);
    fs.unlinkSync(outFile);
  }

  console.log("\n-- action skips cleanly when there's no previous tag --");
  {
    const outFile = path.join(os.tmpdir(), `gh-out2-${Date.now()}.txt`);
    fs.writeFileSync(outFile, "");
    let prCalls = 0;
    global.fetch = async (url, opts = {}) => {
      if (url.includes("/tags")) return mkRes({ body: [{ name: "v1.0.0" }] });
      if (url.includes("/pulls")) { prCalls++; return mkRes({ status: 201, body: {} }); }
      throw new Error(`Unhandled: ${url}`);
    };
    process.env.GITHUB_REF = "refs/tags/v1.0.0";
    process.env.GITHUB_OUTPUT = outFile;
    process.exitCode = 0;

    delete require.cache[require.resolve(require("path").join(__dirname, "..", "action/index.js"))];
    require("../action/index.js");
    await new Promise((r) => setTimeout(r, 150));

    const out = fs.readFileSync(outFile, "utf8");
    check("skipped=true", /skipped<<\S+\ntrue\n/.test(out), out);
    check("made no PR", prCalls === 0);
    check("did not fail the build", process.exitCode !== 1, `exitCode=${process.exitCode}`);
    fs.unlinkSync(outFile);
  }

  console.log("\n-- detailed-analysis input: off by default, diffs never sent --");
  {
    const outFile = path.join(os.tmpdir(), `gh-out3-${Date.now()}.txt`);
    const sumFile = path.join(os.tmpdir(), `gh-sum3-${Date.now()}.txt`);
    fs.writeFileSync(outFile, ""); fs.writeFileSync(sumFile, "");
    let classifyPayload = null;

    global.fetch = async (url, opts = {}) => {
      if (url.includes("/tags")) return mkRes({ body: TAGS });
      if (url.includes("/compare/")) return mkRes({ body: { commits: [{ sha: "s1", commit: { message: "wip" } }],
        files: [{ filename: "src/a.js", status: "modified", changes: 4, patch: "@@ -1,2 +1,3 @@\n+secret-diff-marker" }] } });
      if (url.includes("api.anthropic.com")) {
        const b = JSON.parse(opts.body);
        if (b.system.includes("classification")) classifyPayload = b;
        return mkRes({ body: { content: [{ text: b.system.includes("classification")
          ? '{"changes":[{"sha":"s1","title":"t","category":"feat"}],"version":{"bump":"minor","reasoning":"r"}}'
          : "## notes\n- t" }] } });
      }
      if (url.endsWith("/repos/acme/widgets")) return mkRes({ body: { default_branch: "main" } });
      if (url.includes("/git/ref/heads/")) return mkRes({ body: { object: { sha: "b1" } } });
      if (url.includes("/git/refs")) return mkRes({ status: 201, body: {} });
      if (url.includes("/contents/CHANGELOG.md")) return opts.method === "PUT" ? mkRes({ body: {} }) : mkRes({ status: 404, body: {} });
      if (url.includes("/pulls")) return mkRes({ status: 201, body: { html_url: "https://x/pull/9" } });
      throw new Error("Unhandled: " + url);
    };

    process.env.GITHUB_REPOSITORY = "acme/widgets";
    process.env.GITHUB_REF = "refs/tags/v1.3.0";
    process.env.GITHUB_OUTPUT = outFile;
    process.env.GITHUB_STEP_SUMMARY = sumFile;
    delete process.env.INPUT_DETAILED;
    delete process.env["INPUT_DETAILED-ANALYSIS"];
    delete process.env.INPUT_DETAILED_ANALYSIS;
    process.exitCode = 0;

    delete require.cache[require.resolve(require("path").join(__dirname, "..", "action/index.js"))];
    require("../action/index.js");
    await new Promise((r) => setTimeout(r, 200));

    const out = fs.readFileSync(outFile, "utf8");
    const sum = fs.readFileSync(sumFile, "utf8");
    check("default: no diff sent to the AI", !JSON.stringify(classifyPayload).includes("secret-diff-marker"));
    check("default: no diff report in step summary", !/Detailed analysis: sent/.test(sum), sum.slice(0, 80));
    check("default: no diff-files-sent output", !out.includes("diff-files-sent"));
    fs.unlinkSync(outFile); fs.unlinkSync(sumFile);
  }

  console.log("\n-- detailed-analysis: true sends diffs and reports the cost --");
  for (const inputName of ["INPUT_DETAILED-ANALYSIS", "INPUT_DETAILED"]) {
    const outFile = path.join(os.tmpdir(), `gh-out4-${Date.now()}-${Math.random()}.txt`);
    const sumFile = path.join(os.tmpdir(), `gh-sum4-${Date.now()}-${Math.random()}.txt`);
    fs.writeFileSync(outFile, ""); fs.writeFileSync(sumFile, "");
    let classifyPayload = null;

    global.fetch = async (url, opts = {}) => {
      if (url.includes("/tags")) return mkRes({ body: TAGS });
      if (url.includes("/compare/")) return mkRes({ body: { commits: [{ sha: "s1", commit: { message: "wip" } }],
        files: [{ filename: "src/a.js", status: "modified", changes: 4, patch: "@@ -1,2 +1,3 @@\n+secret-diff-marker" }] } });
      if (url.includes("api.anthropic.com")) {
        const b = JSON.parse(opts.body);
        if (b.system.includes("classification")) classifyPayload = b;
        return mkRes({ body: { content: [{ text: b.system.includes("classification")
          ? '{"changes":[{"sha":"s1","title":"t","category":"feat"}],"version":{"bump":"minor","reasoning":"r"}}'
          : "## notes\n- t" }] } });
      }
      if (url.endsWith("/repos/acme/widgets")) return mkRes({ body: { default_branch: "main" } });
      if (url.includes("/git/ref/heads/")) return mkRes({ body: { object: { sha: "b1" } } });
      if (url.includes("/git/refs")) return mkRes({ status: 201, body: {} });
      if (url.includes("/contents/CHANGELOG.md")) return opts.method === "PUT" ? mkRes({ body: {} }) : mkRes({ status: 404, body: {} });
      if (url.includes("/pulls")) return mkRes({ status: 201, body: { html_url: "https://x/pull/9" } });
      throw new Error("Unhandled: " + url);
    };

    process.env.GITHUB_OUTPUT = outFile;
    process.env.GITHUB_STEP_SUMMARY = sumFile;
    delete process.env.INPUT_DETAILED;
    delete process.env["INPUT_DETAILED-ANALYSIS"];
    delete process.env.INPUT_DETAILED_ANALYSIS;
    process.env[inputName] = "true";
    process.exitCode = 0;

    delete require.cache[require.resolve(require("path").join(__dirname, "..", "action/index.js"))];
    require("../action/index.js");
    await new Promise((r) => setTimeout(r, 200));

    const out = fs.readFileSync(outFile, "utf8");
    const sum = fs.readFileSync(sumFile, "utf8");
    const label = inputName === "INPUT_DETAILED" ? "alias `detailed`" : "`detailed-analysis`";
    check(`${label}: diff reached the AI`, JSON.stringify(classifyPayload).includes("secret-diff-marker"));
    check(`${label}: step summary reports files + chars`, /Detailed analysis: sent 1 file, \d+ characters of diff/.test(sum), sum.slice(0, 160));
    check(`${label}: diff-files-sent output written`, /diff-files-sent<<\S+\n1\n/.test(out), out.slice(0, 120));
    check(`${label}: diff-chars-sent output written`, /diff-chars-sent<</.test(out));
    delete process.env[inputName];
    fs.unlinkSync(outFile); fs.unlinkSync(sumFile);
  }


  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
