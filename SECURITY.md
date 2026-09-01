# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**

Report it privately using GitHub's private vulnerability reporting:

1. Go to the [Security tab](https://github.com/Vansh-kap-98/release-radar-app/security/advisories/new)
   of this repository.
2. Click **Report a vulnerability**.

That opens a private advisory visible only to the maintainers. If private
reporting is not enabled or you cannot use it, email the maintainer listed in
`package.json` instead, with `SECURITY` in the subject line.

Please include what you would want to receive yourself: affected surface
(desktop app, Action, or CLI), version or commit, reproduction steps, and what
an attacker gains.

Expect an acknowledgement within a few days. This is a small,
non-commercial project maintained by one person — there is no bug bounty, and
timelines are best-effort rather than contractual.

## Supported versions

Only the latest commit on `main` is supported. There is no backport branch.

## Trust model — read this first

Release Radar is **BYOK** (bring your own key). There is no Release Radar server,
no account, and no telemetry. Nothing is proxied through infrastructure the
maintainers control. Your keys are used to call GitHub's API and your chosen AI
provider's API **directly**.

That much is true everywhere. But the two ways of running it have **materially
different threat models**, and the difference is the thing most worth
understanding before you audit this repo.

### Desktop app — the key never leaves your machine

- API keys are stored via Electron's `safeStorage`, which encrypts them against
  the OS keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux).
  See `electron/lib/store.js`. They are never written to disk in plain text.
  If the OS provides no encryption backend, the value is stored unencrypted but
  still only locally — that fallback is explicit in the code.
- Keys live only in the Electron **main** process. The renderer never receives
  them: `getAll()` returns booleans (`"configured"` / `"not set"`) for secret
  values, not the values themselves.
- The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, a
  CSP, and a `contextBridge` surface of exactly the named functions in
  `electron/preload.js`. It has no path to raw Node or Electron APIs.
- Outbound traffic goes to `api.github.com` (or your configured GitHub
  Enterprise host), your AI provider, and — only if you configure one — your
  Slack webhook. Nowhere else.
- Generated changelogs are stored locally and **unencrypted** in a separate
  store (`electron/lib/history.js`). This is deliberate: changelogs are not
  secrets. If your commit messages are sensitive, that file is worth knowing
  about.

### GitHub Action — the key lives in GitHub's runner

This is the important difference.

- The Action needs `ai-api-key` as an input. However you supply it, that key is
  **decrypted into the environment of a GitHub Actions runner** and used there.
  It is not on your machine and not under your control while the job runs.
- Store it as a **repository secret**, never inline in the workflow file. Secrets
  are masked in logs, but masking is a mitigation, not a boundary.
- Anyone who can modify a workflow in your repository, or land a change that
  runs in a context with access to your secrets, can exfiltrate that key. This
  is a property of GitHub Actions, not of this project — but it means the Action
  deserves a **lower-privilege, revocable, spend-capped** AI key than the one
  you would put in the desktop app. Treat it as a CI credential.
- Be especially careful with `pull_request_target` and with workflows triggered
  by forks. The [example workflow](action/example-workflow.yml) triggers on tag
  pushes, which does not expose secrets to fork contributors.
- Scope `github-token` to the minimum: `contents: write` and
  `pull-requests: write` are what the `pull-request` target needs.
  `markdown-only` needs neither and writes nothing back to the repo.
- The Action runs `action/index.js` and `core/` **exactly as committed**, with no
  install and no bundling. That is good for auditability — what you read is what
  runs — but it also means pinning matters. Pin to a tag or a commit SHA rather
  than a moving branch if supply-chain risk is a concern for you. See the README
  section on referencing the repo directly.

### CLI

`cli.js` reads keys from flags or environment variables and holds them only in
process memory. Prefer the environment variables over flags — a flag value lands
in your shell history and in the process list on a shared machine.

## Notes for reviewers

Areas worth attention, offered honestly:

- `core/export.js` hand-rolls markdown-to-HTML. It escapes first and applies
  inline markup after, so inserted tags are the only live markup. Input is
  ultimately derived from commit messages, which are untrusted. Exported HTML
  is written to a local file or the clipboard; it is not rendered in-app.
- `core/publish.js` writes to GitHub: it creates a branch, commits
  `CHANGELOG.md`, and opens a PR. The desktop app gates every remote publish
  behind an explicit confirmation step and publishes exactly the markdown the
  user reviewed rather than regenerating it. GitHub Releases are always created
  as **drafts**.
- AI output is constrained but not trusted: every classified entry is filtered
  against the set of real commit SHAs in the range, so the model cannot invent
  commits.
- The configurable GitHub API base URL (for GitHub Enterprise Server) means the
  host your token is sent to is user-controlled. It defaults to
  `https://api.github.com` and is only changed by an explicit Settings edit.
