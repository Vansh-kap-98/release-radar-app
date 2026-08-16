# Release Radar (Desktop App)

Turn a GitHub commit/tag range into a categorized, publish-ready
changelog — as a downloadable Mac/Windows/Linux app. Bring your own
GitHub token and AI API key; nothing is sent to any server you don't
control.

## How it works
1. You enter a repo + two refs in the app.
2. It calls GitHub's Compare API directly (your token, your rate limit).
3. It sends the commit list to your chosen AI provider (Anthropic or
   OpenAI, your API key) to classify each change.
4. A second AI call formats the classified list into markdown.
5. You review it, then optionally publish it — a GitHub Release draft
   or a Slack message — only after you click "Confirm & publish."

## Run it locally (development)
```bash
npm install
npm run dev
```
This starts the Vite dev server and Electron together with hot reload.

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
│   ├── github.js          # commit ranges, commit list, tags, diff summarizing
│   ├── ai.js              # classify + format, retry/backoff, 3 providers
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
│   ├── App.jsx
│   ├── lib/semver.js
│   └── components/        # SettingsForm, CommitPicker, HistoryList
├── index.html
├── vite.config.js
└── package.json
```

`core/` is deliberately free of Electron imports so the exact same pipeline
runs in the desktop app and on GitHub's servers in the Action.

## Detailed analysis (diff-aware mode)

By default, classification uses **commit messages only** — fast and cheap.
Tick **"Detailed analysis"** on the Generate tab to also send GitHub's
file-level diffs, so a commit called "fix stuff" can become a description of
what actually changed.

It's off by default because diffs add roughly 10–20k input tokens per run,
which will exhaust a free-tier key quickly. The payload is bounded regardless:

- each patch capped at 200 lines or 3000 characters, whichever hits first
- only the 30 most-changed files, with the omitted count reported
- a 60k-character ceiling across all patches combined
- binary files and pure renames are described by name/status, never invented

After a detailed run the UI reports exactly what was sent ("sent 12 files,
34.2k chars of diff") so the token cost is never a black box.

## Rate limits

All AI calls retry automatically on HTTP 429: honouring `retry-after` when the
provider sends one, otherwise backing off 1s → 2s → 4s, up to 3 retries. The
UI shows a live countdown while waiting. After that it fails with a readable
message naming the provider rather than a raw fetch error.

Classification results are cached in memory for the session, keyed by
`(repo, fromRef, toRef, detailedMode)`, so re-running an identical request
costs nothing. "Regenerate" from the History tab deliberately bypasses it.

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

Not yet done: publishing to the GitHub Marketplace (step 3 of the roadmap), which
requires a release tag and a Marketplace listing from the repo owner's account.
