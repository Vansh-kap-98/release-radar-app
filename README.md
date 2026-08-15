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
├── electron/
│   ├── main.js          # window creation + IPC handlers
│   ├── preload.js        # safe bridge exposed to the React UI
│   └── lib/
│       ├── github.js     # fetches commit ranges
│       ├── ai.js          # classification + formatting (Anthropic/OpenAI)
│       ├── publish.js     # GitHub Release / Slack posting
│       └── store.js       # encrypted local settings storage
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   └── components/SettingsForm.jsx
├── index.html
├── vite.config.js
└── package.json
```

## Parked: diff-aware changelog generation

Classification currently runs on **commit messages only**. A diff-aware
version — which feeds GitHub's actual file-level diffs to the AI so vague
messages like "fix stuff" become specific entries — is fully built and
tested, but **switched off**: sending diffs pushed API usage past rate
limits. It's parked, not removed.

The code is in place and inert. To turn it back on:

1. `electron/lib/github.js` — in `fetchChangeRange()`, swap the returned
   `fileContext: null` for the commented-out `summarizeFiles(data.files)`
   line directly above it.
2. `electron/lib/ai.js` — raise `max_tokens` from 2000 back to ~8000 in the
   Anthropic branch. Diff-aware titles are longer, and too small a cap
   truncates the JSON array mid-response and fails parsing.

Nothing else needs editing. `classifyChanges()` already switches to the
diff-aware prompt automatically whenever it receives a non-null
`fileContext`, and the supporting pieces stay in the codebase either way:

- `summarizeFiles()` / `truncatePatch()` in `github.js` — cap each patch at
  200 lines or 3000 chars, keep the 30 most-changed files, and enforce a
  60k-char ceiling across all patches so the payload stays bounded.
- `CLASSIFY_SYSTEM_PROMPT_DIFF_AWARE` in `ai.js` — the diff-aware prompt,
  kept as an unused constant.

Known cost before re-enabling: diffs add roughly 10–20k tokens of input per
run on a typical range, which is what triggered the rate limiting. Worth
pairing with a smaller default file cap, or a per-run toggle in the UI so
diffs are opt-in per changelog rather than always on.
