# Release Radar (Desktop App)

Turn a GitHub commit/tag range into a categorized, publish-ready
changelog — as a downloadable Mac/Windows/Linux app. Bring your own
GitHub token and AI API key; nothing is sent to any server you don't
control.

## How it works
1. You enter a repo + two refs in the app.
2. It calls GitHub's Compare API directly (your token, your rate limit).
3. It sends the commit list to your chosen AI provider (Anthropic,
   OpenAI, Groq, or Google Gemini — your API key) to classify each change.
4. A second AI call formats the classified list into markdown.
5. You review it, then optionally publish it — a GitHub Release draft
   or a Slack message — only after you click "Confirm & publish."

## Run it locally (development)
```bash
npm install
npm run dev
```
This starts the Vite dev server and Electron together with hot reload.

## Tests
```bash
npm test
```
426 assertions across 11 suites, no test framework and no dev dependencies —
plain Node scripts, matching `core/`'s dependency-free constraint. They mock
`fetch` and the Electron APIs, so nothing hits a real API or needs a key.

CI runs the same command on every push and pull request
(`.github/workflows/test.yml`), on Node 18, 20 and 22, and additionally fails
the build if `core/` ever grows a dependency or an Electron import.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to add a suite.

## Build artifacts (`dist/`, `release/`)

`dist/` is the compiled renderer. It is **not** tracked in git — regenerate it
with:

```bash
npm run build:renderer
```

Electron loads `dist/index.html` in production and `electron-builder` bundles
it, so a production build needs it to exist, but it is derived entirely from
`src/` and would otherwise churn on every commit. `npm run build` (below) runs
this step for you. `release/` (installers) is untracked for the same reason.

## Build a distributable installer
```bash
npm run build
```
Produces a `.dmg` (mac), `.exe` installer (Windows), or `.AppImage`
(Linux) in `release/`, using `electron-builder`'s config already set
in `package.json`.

Note: to actually codesign/notarize for macOS or codesign for Windows
(needed for the OS to not show a scary "unknown publisher" warning),
you'll need an Apple Developer account ($99/yr) and/or a Windows code
signing certificate. You can ship unsigned first to validate demand,
then sign once you have paying users.

## Selling it
Recommended path for v1:
1. List it on **Gumroad** or **Lemon Squeezy** — both handle payment,
   VAT/tax, and license key delivery for a flat fee per sale (no
   monthly cost). Upload the built installers as the product file.
2. Price as a one-time purchase. Since this is BYOK (bring your own AI
   key), you have zero ongoing costs per user — price accordingly
   lower than a subscription-based competitor.
3. A simple landing page (even a single page with a demo GIF, the
   price, and a buy button linking to Gumroad/Lemon Squeezy) is enough
   for v1 — you don't need your own checkout flow.
4. Optional, later: a lightweight license-key check on first launch
   (Gumroad and Lemon Squeezy both have a "verify license" API) to
   gate repeat piracy — not required to start selling.

## Security notes
- API keys are encrypted at rest using the OS keychain via Electron's
  `safeStorage` (see `electron/lib/store.js`) — never written in plain
  text, never sent anywhere except directly to GitHub/your AI provider.
- The renderer (React UI) never has direct filesystem or network
  access — it only talks to the main process through the specific
  functions exposed in `electron/preload.js`. This is what keeps a
  webpage-style UI safe even though the app has full system access
  under the hood.
- GitHub Releases are always created as **drafts**, never published
  live automatically.

## Project structure
```
release-radar-app/
├── core/                  # pipeline logic, NO Electron dependency
│   ├── github.js          # commit ranges, commit list, tags, diff summarizing,
│   │                      # configurable API host (GitHub Enterprise)
│   ├── ai.js              # classify + format, retry/backoff, 4 providers
│   ├── semver.js          # version bump suggestion (no AI call, no network)
│   ├── export.js          # markdown -> HTML / plain text
│   ├── publish.js         # GitHub Release / Slack / changelog PR
│   └── index.js           # barrel export
├── action/                # companion GitHub Action (uses core/)
│   ├── action.yml
│   ├── index.js
│   └── example-workflow.yml
├── electron/
│   ├── main.js            # window creation + IPC handlers + session cache
│   ├── preload.js         # safe bridge exposed to the React UI
│   └── lib/
│       ├── store.js       # encrypted settings storage (safeStorage)
│       └── history.js     # saved changelogs (plain, not encrypted)
├── src/
│   ├── main.jsx
│   ├── styles.css         # Tailwind 4 theme + design tokens
│   ├── lib/               # api (IPC bridge + mocks), semver, rr-utils, utils
│   └── components/rr/     # App shell, GenerateTab, HistoryTab, SettingsTab,
│                          # CommitPicker, ui primitives
├── test/                  # 426 assertions, `npm test`, no framework
├── .github/workflows/
│   ├── test.yml           # runs the suites on every push/PR
│   └── release-action.yml # moves the floating v1 tag (repo maintenance)
├── cli.js                 # headless entrypoint (uses core/, no deps)
├── index.html
├── vite.config.mjs
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
└── package.json
```

`core/` is deliberately free of Electron imports **and of npm dependencies**, so
the exact same pipeline runs in the desktop app, on GitHub's servers in the
Action, and in `cli.js` — the latter two with no install and no build step. CI
enforces both properties; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Detailed analysis (diff-aware mode)

By default, classification uses **commit messages only** — fast and cheap.
Tick **"Detailed analysis"** on the Generate tab to also send GitHub's
file-level diffs, so a commit called "fix stuff" can become a description of
what actually changed.

It's off by default because diffs add roughly 10–20k input tokens per run,
which will exhaust a free-tier key quickly. The payload is bounded regardless:

- generated files (lockfiles, `dist/`, `build/`, minified bundles, vendored
  code) are listed by name but spend **no** diff budget — ranked purely by size
  they would otherwise crowd out every real source change
- real source is always ranked ahead of generated files, however large those are
- the remaining budget is split across the files that will actually use it, so
  one big file can't starve the rest
- patches are cut on hunk (`@@`) boundaries — a diff sliced at an arbitrary
  character offset ends mid-line and reads as noise
- each patch capped at 200 lines or 3000 characters, whichever hits first
- only 30 files, with the omitted count reported
- a 60k-character ceiling across all patches combined
- binary files and pure renames are described by name/status, never invented

After a detailed run the UI reports exactly what was sent ("sent 12 files,
34.2k chars of diff") so the token cost is never a black box.

## Version suggestions

The AI decides the version bump as part of the **same** classification call — it
already has every commit and diff in front of it, so the recommendation costs no
extra request and no extra rate-limit budget. The scheme is:

- **MAJOR (x)** — a breaking change, or a major feature addition: significant new
  capability, new surface area, architectural shift
- **MINOR (y)** — smaller features, enhancements, additive improvements
- **PATCH (z)** — bug fixes, docs and chores only

Note this deliberately differs from strict semver, which ties MAJOR to breaking
changes alone; here a large feature addition also earns a major bump.

If the model doesn't return a usable bump (older response shape, invalid value,
call skipped), `core/semver.js` falls back to a deterministic category rule —
breaking → major, feat → minor, else patch — and that fallback additionally
applies the semver 0.x guard (a breaking change on 0.4.2 suggests 0.5.0 rather
than 1.0.0). The guard is deliberately NOT applied to an explicit AI decision,
since overriding the model would make "the AI decides" untrue. The UI labels
which path produced the number ("chosen by AI" / "from category rules").

The suggestion is always advisory: it pre-fills an editable field and is never
applied without you confirming it.

## AI providers

Four are supported, chosen in Settings: **Anthropic** (Claude), **OpenAI**,
**Groq**, and **Google Gemini**. Each provider only declares how to shape a
request and read a response (`PROVIDERS` in `core/ai.js`); retry, backoff and
caching live in shared code, so every provider gets them identically and
adding a fifth cannot accidentally skip them.

Two Gemini-specific notes, since its REST shape differs from the rest: the API
key is sent as an `x-goog-api-key` header rather than in the URL (keeping it
out of server logs and browser history), and internal "thinking" is minimised
via `thinkingConfig: { thinkingLevel: "minimal" }` — otherwise the model spends
the output budget on reasoning and truncates the JSON array mid-response.

Note that Gemini 3.x **replaced** 2.5's `thinkingBudget` with `thinkingLevel`;
sending the old field returns a bare `400 INVALID_ARGUMENT` that names no
offending field. `"minimal"` is the lowest accepted value — `"none"` and
`"off"` are rejected — and measures at zero thought tokens.

## Rate limits

All AI calls retry automatically on HTTP 429 (rate limited) and 5xx (provider
transiently overloaded — Gemini returns 503 "high demand" under load):
honouring `retry-after` when the provider sends one, otherwise backing off
1s → 2s → 4s, up to 3 retries. 4xx errors fail immediately, since retrying a
bad request or a bad key never helps. The
UI shows a live countdown while waiting. After that it fails with a readable
message naming the provider rather than a raw fetch error.

Classification results are cached in memory for the session, keyed by
`(repo, fromRef, toRef, detailedMode)`, so re-running an identical request
costs nothing. "Regenerate" from the History tab deliberately bypasses it.

## Command line

`cli.js` runs the same `core/` pipeline headlessly — no Electron, no UI, no
install:

```bash
node cli.js --repo acme/app > CHANGELOG.md
```

Or without cloning at all:

```bash
npx github:Vansh-kap-98/release-radar-app --repo acme/app
```

It is dependency-free like the Action, so `npx` pulls no tree of packages.

Only the changelog goes to stdout; all progress and warnings go to stderr, so
redirecting to a file gives you a clean changelog and still shows progress in
the terminal.

```bash
# a specific range, with diff-aware analysis
node cli.js --repo acme/app --from v1.2.0 --to main --detailed

# structured output for scripting (markdown, changes, version suggestion)
node cli.js --repo acme/app --json

# other formats
node cli.js --repo acme/app --format html
node cli.js --repo acme/app --format text

# opt in to writing back — nothing is published without this flag
node cli.js --repo acme/app --publish pull-request
```

Credentials come from the environment (preferred — a flag lands in your shell
history and the process list):

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` / `GH_TOKEN` | GitHub token |
| `RELEASE_RADAR_AI_KEY` | AI key for any provider |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` / `GOOGLE_API_KEY` | per-provider fallback |
| `GITHUB_API_BASE_URL` | GitHub Enterprise API root |
| `GITHUB_REPOSITORY` | default for `--repo` |

Options can also be piped in as JSON, using the same names without dashes:

```bash
echo '{"repo":"acme/app","detailed":true}' | node cli.js
```

Flags beat stdin; stdin beats the environment. `node cli.js --help` documents
everything. The default publish target is `markdown-only`, so a bare run never
writes to your repository.

## Try demo data

Settings → **Try demo data** fills the app with a fabricated repository —
commits, classifications, version suggestion, changelog history — so you can
see the entire flow before creating a single API key. No network calls are made
and nothing can be published while it is on; a banner across the top says so.

It is off by default and formalizes the mock-data fallback the renderer already
used when run in a plain browser (`npm run dev:renderer`), so UI work needs no
keys either.

## Theme

Settings → **Theme** offers System, Light and Dark. The default is **System**,
which follows your OS exactly as the app always has — existing installs see no
change. Light and Dark pin the theme and stop following the OS. The preference
is stored unencrypted alongside the other non-secret settings.

## GitHub Enterprise Server

Settings → **GitHub API base URL** points every GitHub request at a different
host. Leave it blank for GitHub.com (the default). For GitHub Enterprise Server
use your appliance's API root:

```
https://ghe.example.com/api/v3
```

This covers reads and writes — compare, commits, tags, releases and the whole
pull-request flow — and human-facing links in error messages follow the same
host. The CLI takes `--api-base-url` or `$GITHUB_API_BASE_URL`.

The classification cache is keyed by host, so the same `owner/name` on
github.com and on an appliance never share a cached result.

## History

Every generated changelog is saved locally to `release-radar-history.json`
(separate from the encrypted settings store — changelogs aren't secrets).
The **History** tab lists them newest-first; each entry can be viewed, copied,
regenerated, or deleted. Capped at 200 entries.

## Companion GitHub Action

`action/` contains a GitHub Action that runs the same pipeline in CI, so a
changelog PR opens automatically on tag push without anyone launching the app.

Copy `action/example-workflow.yml` into a repo at
`.github/workflows/release-notes.yml` and add an `AI_API_KEY` repository
secret. On a `v*` tag push it finds the previous tag, classifies everything in
between, and opens a changelog PR.

The Action has **no npm dependencies** and needs no build step — it talks to
the Actions runner through environment variables and runs the committed files
as-is.

⚠️ **BYOK caveat:** in the desktop app your AI key never leaves your machine.
In the Action it lives in GitHub Actions secrets and requests are made from
GitHub's runners, not your computer. That's a real difference in trust model —
use the desktop app if that matters to you.

### Using the Action without a Marketplace listing

This Action is **not published to the GitHub Marketplace**, and it does not need
to be. A Marketplace listing only affects discoverability — any workflow can
reference an Action directly by repository, and it behaves identically:

```yaml
- uses: Vansh-kap-98/release-radar-app@main
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    ai-api-key: ${{ secrets.AI_API_KEY }}
```

`@main` always gets the newest code. **Pin to a tag or commit SHA instead** for
anything you care about, so an upstream change cannot alter a release job
without you noticing:

```yaml
# a release tag
- uses: Vansh-kap-98/release-radar-app@v1.0.0

# the floating major tag — picks up v1.x.y fixes, never a breaking change
- uses: Vansh-kap-98/release-radar-app@v1

# or an exact commit, the strongest guarantee
- uses: Vansh-kap-98/release-radar-app@9e36464cb26e0f3a8f0d0f6f9d2f1a0b9c8d7e6f
```

The floating `v1` tag is maintained automatically by
`.github/workflows/release-action.yml`, which moves it to each new plain
`vX.Y.Z` release (pre-releases are skipped).

The repository must be public, or the calling workflow must be in the same
organization with Actions access configured — the same rule that applies to any
Action referenced by repository.

Because the Action ships **no build output** — GitHub runs `action/index.js` and
`core/` exactly as committed — you can read at a tag precisely what will execute.
That is worth more than a Marketplace badge for auditability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The two rules most likely to trip up a
PR: `core/` must stay dependency-free (it is what lets the Action and the CLI
run with no install step), and new features must not change default behavior.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability privately, and
for the trust-model difference between the desktop app (your key never leaves
your machine) and the Action (your key runs on GitHub's runners).

## License

[MIT](LICENSE) © Vansh Kapoor
