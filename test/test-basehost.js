// Covers the configurable GitHub API base URL (GitHub Enterprise Server).
//
// The load-bearing property is that an absent/blank value behaves EXACTLY as
// the hardcoded api.github.com did, so existing users are unaffected. Most of
// these assertions are about that, not about the enterprise path.

const {
  apiBase,
  webBase,
  DEFAULT_API_BASE_URL,
  fetchChangeRange,
  listCommits,
  getRepoDefaults,
  listTags
} = require("../core/github.js");
const { publishGithubRelease, openChangelogPullRequest } = require("../core/publish.js");

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

// Records every URL requested, answering from a path-suffix -> body table.
function recordingFetch(routes) {
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    for (const [needle, res] of routes) {
      if (String(url).includes(needle)) return mkRes(res);
    }
    return mkRes({ status: 404, body: {} });
  };
  return urls;
}

const GHES = "https://ghe.example.com/api/v3";

(async () => {
  console.log("-- apiBase() resolution --");
  {
    check("undefined -> github.com", apiBase(undefined) === DEFAULT_API_BASE_URL, apiBase(undefined));
    check("null -> github.com", apiBase(null) === DEFAULT_API_BASE_URL);
    check("empty string -> github.com", apiBase("") === DEFAULT_API_BASE_URL);
    check("whitespace -> github.com", apiBase("   ") === DEFAULT_API_BASE_URL);
    check("non-string -> github.com", apiBase(42) === DEFAULT_API_BASE_URL);
    check("default constant is api.github.com", DEFAULT_API_BASE_URL === "https://api.github.com");
    check("custom base is used verbatim", apiBase(GHES) === GHES, apiBase(GHES));
    check("trailing slash trimmed", apiBase(`${GHES}/`) === GHES, apiBase(`${GHES}/`));
    check("many trailing slashes trimmed", apiBase(`${GHES}///`) === GHES);
    check("surrounding whitespace trimmed", apiBase(`  ${GHES}  `) === GHES);
  }

  console.log("-- webBase() resolution --");
  {
    check("default web host is github.com", webBase("") === "https://github.com", webBase(""));
    check("undefined -> github.com", webBase(undefined) === "https://github.com");
    check("GHES strips /api/v3", webBase(GHES) === "https://ghe.example.com", webBase(GHES));
    check("GHES strips /api/v3/ with slash", webBase(`${GHES}/`) === "https://ghe.example.com");
    check(
      "a base without /api/v3 is left alone",
      webBase("https://ghe.example.com") === "https://ghe.example.com"
    );
  }

  console.log("-- reads default to api.github.com when no base is given --");
  {
    const urls = recordingFetch([
      ["/compare/", { body: { commits: [], files: [] } }],
      ["/commits?", { body: [] }],
      ["/tags?", { body: [] }],
      ["/releases/latest", { body: { tag_name: "v1.0.0" } }],
      ["/repos/", { body: { default_branch: "main" } }]
    ]);

    await fetchChangeRange({ repo: "a/b", fromRef: "v1", toRef: "v2", githubToken: "t" });
    await listCommits({ repo: "a/b", githubToken: "t" });
    await getRepoDefaults({ repo: "a/b", githubToken: "t" });
    await listTags({ repo: "a/b", githubToken: "t" });

    check("every read hit api.github.com", urls.every((u) => u.startsWith("https://api.github.com/")), urls);
    check("no request went anywhere else", urls.length > 0 && !urls.some((u) => u.includes("ghe.example.com")));
  }

  console.log("-- reads honour a custom base --");
  {
    const urls = recordingFetch([
      ["/compare/", { body: { commits: [], files: [] } }],
      ["/commits?", { body: [] }],
      ["/tags?", { body: [] }],
      ["/releases/latest", { body: { tag_name: "v1.0.0" } }],
      ["/repos/", { body: { default_branch: "main" } }]
    ]);

    await fetchChangeRange({ repo: "a/b", fromRef: "v1", toRef: "v2", githubToken: "t", apiBaseUrl: GHES });
    await listCommits({ repo: "a/b", githubToken: "t", apiBaseUrl: GHES });
    await getRepoDefaults({ repo: "a/b", githubToken: "t", apiBaseUrl: GHES });
    await listTags({ repo: "a/b", githubToken: "t", apiBaseUrl: GHES });

    check("every read hit the enterprise host", urls.every((u) => u.startsWith(`${GHES}/`)), urls);
    check("nothing leaked to api.github.com", !urls.some((u) => u.startsWith("https://api.github.com")), urls);
    check("compare path is still correct", urls.some((u) => u === `${GHES}/repos/a/b/compare/v1...v2`), urls);
  }

  console.log("-- writes default to api.github.com --");
  {
    const urls = recordingFetch([["/releases", { body: { html_url: "https://x/1" } }]]);
    await publishGithubRelease({ repo: "a/b", range: "v1...v2", markdown: "m", githubToken: "t" });
    check("release POST hit api.github.com", urls[0] === "https://api.github.com/repos/a/b/releases", urls);
  }

  console.log("-- writes honour a custom base --");
  {
    const urls = recordingFetch([["/releases", { body: { html_url: "https://x/1" } }]]);
    await publishGithubRelease({
      repo: "a/b", range: "v1...v2", markdown: "m", githubToken: "t", apiBaseUrl: GHES
    });
    check("release POST hit the enterprise host", urls[0] === `${GHES}/repos/a/b/releases`, urls);
  }

  console.log("-- the whole PR flow stays on one host --");
  {
    const seen = [];
    global.fetch = async (url) => {
      const u = String(url);
      seen.push(u);
      if (u.endsWith("/repos/a/b")) return mkRes({ body: { default_branch: "main" } });
      if (u.includes("/git/ref/heads/")) return mkRes({ body: { object: { sha: "deadbeef" } } });
      if (u.endsWith("/git/refs")) return mkRes({ body: {} });
      if (u.includes("/contents/CHANGELOG.md?ref=")) return mkRes({ status: 404, body: {} });
      if (u.endsWith("/contents/CHANGELOG.md")) return mkRes({ body: {} });
      if (u.endsWith("/pulls")) return mkRes({ body: { html_url: `${GHES}/a/b/pull/1` } });
      return mkRes({ status: 500, body: {} });
    };

    const url = await openChangelogPullRequest({
      repo: "a/b", range: "v1...v2", markdown: "m", version: "v2", githubToken: "t", apiBaseUrl: GHES
    });
    check("PR flow returned a url", typeof url === "string" && url.length > 0, url);
    check("every PR-flow request used the enterprise host", seen.every((u) => u.startsWith(`${GHES}/`)), seen);
    check("PR flow made all six calls", seen.length === 6, seen.length);
  }

  console.log("-- enterprise error messages point at the enterprise host --");
  {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith("/repos/a/b")) return mkRes({ body: { default_branch: "main" } });
      if (u.includes("/git/ref/heads/")) return mkRes({ body: { object: { sha: "deadbeef" } } });
      if (u.endsWith("/git/refs")) return mkRes({ status: 403, body: {} });
      return mkRes({ status: 500, body: {} });
    };

    let message = "";
    try {
      await openChangelogPullRequest({
        repo: "a/b", range: "v1...v2", markdown: "m", version: "v2", githubToken: "t", apiBaseUrl: GHES
      });
    } catch (e) {
      message = e.message;
    }
    check("403 advice names the enterprise host", message.includes("ghe.example.com/settings/tokens"), message);
    check("403 advice does not name github.com", !message.includes("github.com/settings/tokens"), message);
  }

  console.log("-- default error messages still name github.com --");
  {
    global.fetch = async (url) => {
      const u = String(url);
      if (u.endsWith("/repos/a/b")) return mkRes({ body: { default_branch: "main" } });
      if (u.includes("/git/ref/heads/")) return mkRes({ body: { object: { sha: "deadbeef" } } });
      if (u.endsWith("/git/refs")) return mkRes({ status: 403, body: {} });
      return mkRes({ status: 500, body: {} });
    };

    let message = "";
    try {
      await openChangelogPullRequest({
        repo: "a/b", range: "v1...v2", markdown: "m", version: "v2", githubToken: "t"
      });
    } catch (e) {
      message = e.message;
    }
    check("403 advice names github.com by default", message.includes("https://github.com/settings/tokens"), message);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
