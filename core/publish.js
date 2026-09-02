const { apiBase, webBase } = require("./github");

function authHeaders(githubToken) {
  return {
    Authorization: `Bearer ${githubToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

// Writes need an explicit JSON content-type — fetch() otherwise labels a
// string body as text/plain, which GitHub can reject on mutating endpoints.
function writeHeaders(githubToken) {
  return { ...authHeaders(githubToken), "content-type": "application/json" };
}

// `version` is the user-confirmed tag (from the semver suggestion, possibly
// edited). It is passed in rather than derived here so that what the user
// approved in the UI is exactly what gets tagged. Falls back to the range's
// end ref when no version was supplied.
async function publishGithubRelease({ repo, range, markdown, githubToken, version, apiBaseUrl }) {
  const toRef = (version && String(version).trim()) || range.split("...")[1];
  const res = await fetch(`${apiBase(apiBaseUrl)}/repos/${repo}/releases`, {
    method: "POST",
    headers: { ...authHeaders(githubToken), "content-type": "application/json" },
    body: JSON.stringify({
      tag_name: toRef,
      name: `${toRef}`,
      body: markdown,
      draft: true // always a draft — never publishes live automatically
    })
  });
  if (!res.ok) throw new Error(`GitHub release creation failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.html_url;
}

async function postToSlack({ markdown, webhookUrl }) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: markdown })
  });
  if (!res.ok) throw new Error(`Slack post failed: ${res.status} ${await res.text()}`);
}

function sanitizeBranchSegment(text) {
  const cleaned = (text || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "update";
}

// Write the changelog back as a PR instead of just showing
// markdown in the app. Touches exactly one file, so this uses GitHub's
// Contents API (create-or-update-file, which internally handles the
// blob/commit for us) rather than driving the low-level Git Data API by
// hand — same end result, less surface area for a single-file change.
// `prBody` lets the PR description carry extra context (a version suggestion,
// say) without that text leaking into the committed CHANGELOG.md, which should
// contain only the changelog itself. Defaults to the changelog text.
async function openChangelogPullRequest({ repo, range, markdown, version, githubToken, prBody, apiBaseUrl }) {
  const api = apiBase(apiBaseUrl);

  // 1. Find the repo's actual default branch (not a hardcoded "main").
  const repoRes = await fetch(`${api}/repos/${repo}`, { headers: authHeaders(githubToken) });
  if (!repoRes.ok) throw new Error(`Failed to read repo info: ${repoRes.status} ${await repoRes.text()}`);
  const { default_branch: defaultBranch } = await repoRes.json();

  // 2. Read the commit SHA the default branch currently points at.
  const refRes = await fetch(
    `${api}/repos/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`,
    { headers: authHeaders(githubToken) }
  );
  if (!refRes.ok) throw new Error(`Failed to read default branch ref: ${refRes.status} ${await refRes.text()}`);
  const refData = await refRes.json();
  const baseSha = refData.object?.sha;

  // 3. Create a new branch off that commit.
  const branchName = `release-notes/${sanitizeBranchSegment(version)}-${Date.now().toString(36)}`;
  const createRefRes = await fetch(`${api}/repos/${repo}/git/refs`, {
    method: "POST",
    headers: writeHeaders(githubToken),
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha })
  });
  if (!createRefRes.ok) {
    if (createRefRes.status === 403) {
      throw new Error(
        "GitHub denied branch creation (403). Your token needs the \"Contents\" permission set to Read and write — " +
          `check it at ${webBase(apiBaseUrl)}/settings/tokens.`
      );
    }
    throw new Error(`Failed to create branch ${branchName}: ${createRefRes.status} ${await createRefRes.text()}`);
  }

  // 4. Check whether CHANGELOG.md already exists on the new branch.
  const existingRes = await fetch(
    `${api}/repos/${repo}/contents/CHANGELOG.md?ref=${encodeURIComponent(branchName)}`,
    { headers: authHeaders(githubToken) }
  );

  let existingSha = null;
  let existingContent = "";
  if (existingRes.status === 200) {
    const existingData = await existingRes.json();
    existingSha = existingData.sha;
    existingContent = Buffer.from(existingData.content, "base64").toString("utf8");
  } else if (existingRes.status !== 404) {
    throw new Error(`Failed to read CHANGELOG.md: ${existingRes.status} ${await existingRes.text()}`);
  }

  // 5. Prepend the new section if the file exists; create it fresh if not.
  const newContent = existingContent ? `${markdown}\n\n${existingContent}` : `# Changelog\n\n${markdown}\n`;

  const putRes = await fetch(`${api}/repos/${repo}/contents/CHANGELOG.md`, {
    method: "PUT",
    headers: writeHeaders(githubToken),
    body: JSON.stringify({
      message: `docs: update changelog for ${range}`,
      content: Buffer.from(newContent, "utf8").toString("base64"),
      branch: branchName,
      ...(existingSha ? { sha: existingSha } : {})
    })
  });
  if (!putRes.ok) throw new Error(`Failed to write CHANGELOG.md: ${putRes.status} ${await putRes.text()}`);

  // 6. Open the PR, using the same markdown as its description.
  const prRes = await fetch(`${api}/repos/${repo}/pulls`, {
    method: "POST",
    headers: writeHeaders(githubToken),
    body: JSON.stringify({
      title: `Release notes: ${version || range}`,
      head: branchName,
      base: defaultBranch,
      body: prBody || markdown
    })
  });
  if (!prRes.ok) {
    // The branch and commit already landed by this point, so say so — the
    // work isn't lost, only the PR step failed.
    // Human-facing link only, so it uses the web host rather than the API host.
    const compareUrl = `${webBase(apiBaseUrl)}/${repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(branchName)}?expand=1`;
    if (prRes.status === 403) {
      throw new Error(
        `Branch "${branchName}" and the CHANGELOG.md commit were created, but GitHub denied opening the pull request (403). ` +
          "Your token needs the \"Pull requests\" permission set to Read and write (Contents alone isn't enough) — " +
          `check it at ${webBase(apiBaseUrl)}/settings/tokens. You can also open the PR manually: ${compareUrl}`
      );
    }
    throw new Error(
      `Branch "${branchName}" and the CHANGELOG.md commit were created, but opening the pull request failed: ` +
        `${prRes.status} ${await prRes.text()}. You can open it manually: ${compareUrl}`
    );
  }
  const prData = await prRes.json();
  return prData.html_url;
}

module.exports = { publishGithubRelease, postToSlack, openChangelogPullRequest, sanitizeBranchSegment };
