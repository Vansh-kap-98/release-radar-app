# Release Radar — Feature Roadmap

Planning document only — nothing here is built yet. Each feature has a
description, why it matters, and rough implementation steps for when
we're ready to build it.

---

## 1. Visual commit range picker (no manual SHA hunting)

**Description:** Instead of typing in two commit SHAs by hand, the app
fetches and displays the repo's commit list right inside the app —
scrollable, with commit message, author, and date — and the user just
clicks one commit as the start point and one as the end point.

**Why it matters:** this is the single biggest usability blocker right
now. Finding a SHA means leaving the app, digging through GitHub's
website, copying a 7-character code correctly. A visual picker turns a
3-minute manual task into two clicks.

**📖 Concepts involved:**
- **Pagination** — GitHub's commit list API only returns a limited
  number of commits per request (e.g. 30), so a long history needs
  multiple requests as the user scrolls ("load more").
- **Controlled component** — in React, a UI element (like a
  highlighted commit row) whose selected state lives in the app's
  state, not the DOM itself — needed to track "start" and "end"
  clicks.

**Implementation steps:**
1. Add a new IPC handler, e.g. `release-radar:list-commits`, that
   calls `GET /repos/{repo}/commits?sha={branch}&per_page=30` (a
   different, simpler GitHub endpoint than the Compare API we use now
   — this one just lists commits, no range needed yet).
2. Render the list in the UI: one row per commit, showing message
   (first line only), author, relative date ("3 days ago").
3. Track two pieces of state: `selectedStart` and `selectedEnd`. First
   click sets start, second click sets end (with basic validation:
   end must be more recent than start).
4. Add a "Load older commits" button at the bottom that fetches the
   next page using GitHub's pagination (`page` query param or the
   `Link` header GitHub returns).
5. Once both are picked, feed their SHAs into the existing
   `fetchAndClassifyChanges` flow — this feature only changes *how*
   the user picks refs, not what happens after.
6. Keep the manual text-entry fields too, collapsed under an
   "Advanced: enter refs manually" toggle, for power users or CI-style
   use cases.

---

## 2. Auto-detect latest release as the default range

**Description:** On typing just a repo name, the app automatically
looks up the most recent tag and pre-fills `fromRef` with it and
`toRef` with the default branch — so for the common case ("what's
changed since our last release") there's nothing left to pick at all.

**Why it matters:** removes setup entirely for the most common use
case; manual picking (feature 1) becomes the fallback, not the norm.

**Implementation steps:**
1. New IPC handler calling `GET /repos/{repo}/tags` (or
   `/releases/latest` for a cleaner "latest release" concept, which
   excludes pre-releases/drafts by default).
2. On repo input, auto-populate `fromRef` with the latest tag's name.
3. Default `toRef` to the repo's default branch (fetched from
   `GET /repos/{repo}` → `default_branch` field, not hardcoded `main`,
   since some repos use `master` or other names).
4. Still let the user override both fields manually.

---

## 3. Write the changelog back as a Pull Request

**Description:** Instead of only showing markdown in the app, add a
button that creates a branch, updates (or creates) `CHANGELOG.md` in
the target repo, and opens a Pull Request with the new content —
using GitHub's API to do all three steps.

**Why it matters:** this is what turns the app from "a viewer" into
"a tool that does the work for you." A changelog you have to manually
copy-paste into your repo is still homework; one that shows up as a
ready-to-merge PR is done work.

**📖 Concepts involved:**
- **Git tree / blob API** — GitHub's lower-level API for creating
  file changes without a local git clone: you create a new "blob"
  (file content), a new "tree" (folder structure referencing it), a
  new "commit" pointing at that tree, then move a branch ref to that
  commit.
- **Write scope** — this feature needs the GitHub token's "Contents"
  permission set to Read **and write**, not just read-only (see the
  Settings screen — we already support this, just unused so far).

**Implementation steps:**
1. Add a "Open as Pull Request" option alongside the existing publish
   targets (GitHub Release / Slack / Markdown only).
2. On confirm: create a new branch off the default branch (e.g.
   `release-notes/v1.1.0`).
3. Check if `CHANGELOG.md` exists; if yes, prepend the new section; if
   no, create it fresh.
4. Commit that change to the new branch via the Git Data API.
5. Open a PR from that branch into the default branch, with the
   markdown as the PR description too.
6. Return the PR URL to the UI so the user can click straight to it.

---

## 4. Semantic version suggestion

**Description:** Since changes are already classified into
feat/fix/breaking/docs/chore, the app can apply semantic versioning
rules automatically and suggest the next version number.

**Why it matters:** "is this a minor or a patch bump?" is a genuinely
annoying manual decision for maintainers. Automating it is real value,
not just cosmetic.

**📖 Concepts involved:**
- **Semantic Versioning (semver)** — the `MAJOR.MINOR.PATCH` numbering
  convention where MAJOR = breaking changes, MINOR = new features
  (backwards-compatible), PATCH = fixes only.

**Implementation steps:**
1. After classification, scan the results: any `breaking` → suggest
   MAJOR bump; else any `feat` → suggest MINOR; else → suggest PATCH.
2. Parse the current latest tag (e.g. `v1.4.2`) and compute the
   suggested next tag (e.g. `v2.0.0`) using that rule.
3. Show it as a suggestion in the UI, pre-filled but editable — never
   auto-apply a version number without the user confirming it.

---

## 5. Companion GitHub Action (zero-click automation)

**Description:** A small, separate open-source GitHub Action
(a YAML file users drop into their repo's `.github/workflows/`) that
runs the same classify-and-format logic automatically whenever a new
tag is pushed — no one has to remember to open the desktop app at all.

**Why it matters:** the desktop app is great for one-off, controlled
use. A CI-integrated version is what creates habitual, invisible
usage — the tool works even when nobody thinks to run it.

**📖 Concepts involved:**
- **GitHub Action** — a small automated task GitHub runs for you in
  response to repo events (push, tag, PR opened, etc.), defined in a
  YAML file.
- **Secrets in CI** — GitHub Actions has its own secure way to store
  API keys (repo Settings → Secrets), separate from our app's local
  encrypted storage — the same AI/GitHub keys would need to be added
  there too, since Actions run on GitHub's servers, not the user's
  computer.

**Implementation steps:**
1. Extract the core classify/format logic from `electron/lib/` into a
   standalone Node package with no Electron dependency.
2. Wrap it in a GitHub Action (`action.yml` + a small entrypoint
   script).
3. Publish it to the GitHub Marketplace.
4. On tag push, the Action fetches the range since the last tag,
   classifies, formats, and opens the same kind of PR as feature 3 —
   fully automatically.

---

## 6. Multiple export destinations

**Description:** Beyond GitHub Release / Slack, let the generated
markdown also export to: a Notion page, a plain HTML block for
pasting into a blog, or plain text formatted for an email newsletter.

**Why it matters:** teams announce releases in different places;
supporting more destinations without regenerating content each time
increases how often people reach for the tool.

**Implementation steps:**
1. Keep the classify+format pipeline exactly as-is — this feature only
   adds new "publish" targets, same pattern as `publish.js` already
   uses for GitHub/Slack.
2. Add a Notion integration (Notion API, OAuth-based).
3. Add a simple HTML formatter (convert the same markdown to styled
   HTML using a library like `marked`).
4. Add a plain-text formatter stripped of markdown syntax for email.

---

## 7. GitHub OAuth login + repo picker

**Description:** Instead of manually pasting a personal access token
and typing `owner/name`, let users click "Sign in with GitHub" and
then pick from a dropdown of repos they actually have access to.

**Why it matters:** removes the single most technical setup step
(generating a fine-grained PAT with the right scopes) for less
technical users — broadens who can use the app at all.

**📖 Concepts involved:**
- **OAuth** — a standard way to let an app act on your behalf on
  another service (GitHub, Google, etc.) without ever seeing your
  password, via a login popup and short-lived access tokens.
- **OAuth Device Flow** — the specific OAuth variant well-suited to
  desktop apps (no web server needed to receive a redirect) — GitHub
  supports this natively.

**Implementation steps:**
1. Register a GitHub OAuth App in GitHub's developer settings.
2. Implement the Device Flow: app requests a code, shows it to the
   user, user enters it on github.com, app polls until authorized.
3. Store the resulting OAuth token the same way we store the PAT now
   (encrypted via `safeStorage`).
4. Use the token to call `GET /user/repos` and populate a searchable
   dropdown instead of a free-text repo field.
5. Keep manual PAT entry available as a fallback/advanced option.

---

## 8. Local history of generated changelogs

**Description:** Save every changelog the app generates locally, with
a simple list/search screen to browse past ones — so nothing is
one-and-done.

**Why it matters:** small feature, but turns the app from a stateless
tool into something with accumulated value the longer you use it.

**Implementation steps:**
1. Add a new key pattern in `electron-store` (or a simple local JSON
   file) storing `{ repo, range, markdown, createdAt }` entries.
2. Add a "History" tab in the UI listing past entries, newest first.
3. Clicking one re-displays the markdown, with a "regenerate" option
   that re-runs the fetch/classify/format pipeline for the same range.

---

## Suggested build order

1. Feature 1 (commit picker) + Feature 2 (auto-detect latest tag) —
   biggest usability win, smallest scope, no new external integrations.
2. Feature 4 (semver suggestion) — small, self-contained, adds real
   value on top of data we already have.
3. Feature 3 (PR write-back) — the big one that changes what the
   product fundamentally does.
4. Feature 8 (history) — easy, nice-to-have, can slot in anytime.
5. Feature 5 (GitHub Action) — bigger scope, worth doing once the core
   app is stable and validated.
6. Features 6 and 7 — polish/reach, once there's an actual user base
   asking for them.
