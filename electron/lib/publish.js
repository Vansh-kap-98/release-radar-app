async function publishGithubRelease({ repo, range, markdown, githubToken }) {
  const toRef = range.split("...")[1];
  const res = await fetch(`https://api.github.com/repos/${repo}/releases`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
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

module.exports = { publishGithubRelease, postToSlack };
