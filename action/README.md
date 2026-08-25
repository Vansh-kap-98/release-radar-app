# Release Radar Changelog — GitHub Action

Turn a commit range into a categorized changelog with AI, and open it as a
pull request — automatically, on every version tag you push.

On a `v*` tag push it finds the previous tag, classifies everything in between
as features / fixes / breaking changes / docs / chores, formats it as markdown,
and opens a pull request that updates `CHANGELOG.md`. It also recommends the
next version number and puts that at the top of the PR description.

The action has **no npm dependencies and no build step** — it talks to the
Actions runner through environment variables and runs the committed files
exactly as they are.

---

## ⚠️ Read this before you use it: where your API key runs

This action is **bring-your-own-key**. You supply an API key for Anthropic,
OpenAI, Groq, or Google Gemini, and it is used to call that provider directly.

**Your AI API key is stored in GitHub Actions secrets and used from GitHub's
runners — not from your own machine.** That is a genuinely different trust model
from the Release Radar desktop app, where the key never leaves your computer.

Concretely, when you use this action:

- your key sits in GitHub's secret store, decrypted into a runner at job time
- your commit messages (and, with `detailed-analysis: "true"`, your code diffs) are sent
  from GitHub's infrastructure to your AI provider
- anyone who can push a workflow change to this repository can potentially
  arrange for that secret to be used

If that is not acceptable for your repository, use the desktop app instead —
same pipeline, key never leaves your machine.

Standard precautions apply: use a key scoped to the smallest useful budget, and
review workflow changes in pull requests like any other privileged code.

---

## Quick start

1. Add a repository secret named `AI_API_KEY`
   (**Settings → Secrets and variables → Actions → New repository secret**)
   containing your API key for whichever provider you pick.
2. Create `.github/workflows/release-notes.yml` with the workflow below.
3. Push a version tag (`git tag v1.2.0 && git push origin v1.2.0`).

```yaml
name: Release notes

on:
  push:
    tags:
      - "v*"

jobs:
  changelog:
    runs-on: ubuntu-latest

    # The default GITHUB_TOKEN needs these raised to open a PR.
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4

      - name: Generate changelog PR
        id: changelog
        uses: Vansh-kap-98/release-radar-app@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          ai-provider: anthropic
          ai-api-key: ${{ secrets.AI_API_KEY }}
          publish-target: pull-request
          # Set to "true" for richer descriptions built from file diffs.
          # Adds roughly 10-20k input tokens per run — see "Detailed analysis".
          detailed-analysis: "false"

      - name: Show result
        if: steps.changelog.outputs.skipped != 'true'
        run: echo "Opened ${{ steps.changelog.outputs.published-url }}"
```

`permissions: contents: write` and `pull-requests: write` are required — without
them the action creates the branch and commit, then fails when it tries to open
the pull request.

---

## Inputs

| Input | Type | Required | Default | Description |
|---|---|---|---|---|
| `github-token` | string | yes | `${{ github.token }}` | Token used to read commits and open the PR. Needs **Contents: write** and **Pull requests: write**. |
| `ai-api-key` | string | yes | — | API key for the chosen provider. **Always pass this from a secret**, never inline. |
| `ai-provider` | string | no | `anthropic` | One of `anthropic`, `openai`, `groq`, `google`. |
| `from-ref` | string | no | previous tag | Start of the range. Defaults to the tag before the one being released. |
| `to-ref` | string | no | pushed tag | End of the range. Defaults to the pushed tag, or the repository's default branch. |
| `detailed-analysis` | string | no | `"false"` | `"true"` sends file diffs to the AI, so vague commit messages ("fix stuff", "wip") still produce accurate entries. Adds roughly **10–20k input tokens per run** — enough to exhaust a free-tier key in one request. See [Detailed analysis](#detailed-analysis) below. |
| `detailed` | string | no | `"false"` | Deprecated alias for `detailed-analysis`. |
| `publish-target` | string | no | `pull-request` | `pull-request`, `github-release` (creates a **draft** release), or `markdown-only` (writes nothing back). |
| `version` | string | no | pushed tag | Version label for the PR title and branch name. |

All inputs are strings — YAML booleans must be quoted (`detailed-analysis: "true"`).

## Outputs

| Output | Description |
|---|---|
| `markdown` | The generated changelog markdown. |
| `suggested-version` | Recommended next version, e.g. `v1.5.0`. Empty when the range start isn't a parseable version. |
| `suggested-bump` | `major`, `minor`, or `patch`. Empty when no suggestion was possible. |
| `published-url` | URL of the created pull request or draft release, when one was made. |
| `skipped` | `true` when there was nothing to do — no previous tag, or no commits in range. |
| `diff-files-sent` | Detailed analysis only: how many files' diffs were sent to the AI. |
| `diff-chars-sent` | Detailed analysis only: total characters of diff sent to the AI. |

Reference them as `steps.<id>.outputs.<name>` (the step needs an `id`).

---

## Detailed analysis

Off by default. With `detailed-analysis: "true"` the action also sends GitHub's
file diffs to the AI, so a commit message like `fix stuff` still yields an
accurate changelog entry describing what actually changed.

**The tradeoff is cost.** Diffs add roughly **10–20k input tokens per run** —
enough to blow through a free-tier key's rate limit in a single request. Leave
it off unless your key has the headroom.

The payload is bounded no matter how large the underlying diff is:

- lockfiles, build output, minified bundles and vendored code are listed by
  name only and consume **zero** diff budget — one regenerated lockfile would
  otherwise crowd out every real change
- real source files are ranked ahead of generated files regardless of size
- each patch is capped at 200 lines or 3000 characters, cut on a hunk (`@@`)
  boundary so what's included stays readable
- at most 30 files, with the omitted count reported
- a hard ceiling of 60,000 characters across all patches combined, split across
  the files that will use it so one big file can't starve the rest
- binary files and pure renames are described by name and status, never invented

Because a CI run has no interactive UI, the action reports what it actually
sent to the workflow's **step summary** and log, for example:

```
Detailed analysis: sent 12 files, 34.2k characters of diff (3 omitted).
```

The same numbers are available as the `diff-files-sent` and `diff-chars-sent`
outputs.

## Behaviour worth knowing

**It skips instead of failing.** No previous tag to compare against, or no
commits in the range → the action logs why, sets `skipped: true`, and exits
successfully. It does not fail your release workflow over an empty changelog.

**Draft releases only.** `publish-target: github-release` always creates a
**draft** — nothing is published live without you clicking publish.

**The changelog file stays clean.** The version recommendation goes in the pull
request description only; the committed `CHANGELOG.md` contains changelog text
and nothing else.

**Rate limits are handled.** HTTP 429 and 5xx responses retry with backoff
(honouring `retry-after` when the provider sends one), up to 3 retries, before
failing with a readable message.

**Version scheme.** The AI recommends the bump: major for a breaking change *or*
a major feature addition, minor for smaller features, patch for fixes and chores
only. Note this deliberately differs from strict semver, which ties major to
breaking changes alone.

---

## Versioning

Use the floating major tag so you get fixes without pinning to a patch:

```yaml
uses: Vansh-kap-98/release-radar-app@v1
```

Pin exactly if you prefer reproducible builds:

```yaml
uses: Vansh-kap-98/release-radar-app@v1.2.0
```

`v1` is moved to each new `v1.x.y` release automatically by
`.github/workflows/release-action.yml` in this repository.
