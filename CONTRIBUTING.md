# Contributing to Release Radar

Thanks for taking a look. This is a small codebase with a couple of unusual
rules that exist for concrete reasons — please read the two "hard constraints"
sections before opening a PR, because they are the things most likely to get an
otherwise good change sent back.

## Getting set up

```bash
npm install
```

Then pick a surface:

```bash
npm run dev
```

Runs the Vite dev server and Electron together — this is the normal way to work
on the desktop app.

```bash
npm run dev:renderer
```

Runs only the React UI in a browser. There is no Electron bridge there, so the
UI falls back to mock data (the same data behind the **Try demo data** toggle in
Settings). Handy for pure UI work with no API keys involved.

```bash
node cli.js --help
```

Runs the pipeline headlessly against `core/`.

## Running the tests

```bash
node test/run-all.js
```

or equivalently:

```bash
npm test
```

There is no test framework. `test/run-all.js` shells out to every `test-*.js`
in `test/`, scrapes each one's `"N passed, M failed"` tally, and exits non-zero
if any suite fails. Each suite is a plain Node script you can also run directly:

```bash
node test/test-semver.js
```

This is a deliberate consequence of the `core/` rule below — a test framework
would be a dependency, and the whole point is that this repo installs and runs
with as little machinery as possible. If you add a suite, name it `test-*.js`,
print a final `N passed, M failed` line, and it will be picked up automatically.

CI (`.github/workflows/test.yml`) runs exactly this command on every push and
pull request. If it is red, the PR is not ready.

## Hard constraint 1: `core/` is dependency-free

`core/` has an empty `dependencies` block and it must stay that way.
`core/package.json` is not decoration — it is a promise the rest of the repo
relies on.

The reason: `core/` is consumed by two very different runtimes.

- The **desktop app** requires it from the Electron main process.
- The **GitHub Action** requires it from `action/index.js`, which GitHub runs
  **exactly as committed**. There is no `npm install` step and no bundling step
  in the Action. If `core/` grows a dependency, the Action breaks for everyone
  the moment it is released.

Practical rules:

- No `require()` of anything outside Node's standard library and other `core/`
  files. Global `fetch()` is fine (Node 18+, which is what `engines` declares).
- No `require("electron")`, directly or transitively. Anything needing Electron
  — encrypted key storage, IPC, dialogs, windows — lives in `electron/` and is
  passed into `core/` as plain arguments.
- Same rule applies to `action/`: it talks to the Actions runner through the
  documented `INPUT_*` / `GITHUB_OUTPUT` environment protocol rather than
  `@actions/core`, for the same no-build-step reason.
- `cli.js` follows the same rule, so `npx github:Vansh-kap-98/release-radar-app`
  works without pulling a dependency tree.

If you genuinely need a library, the answer is usually to write the narrow
version of it in `core/` and test it. `core/export.js` is the worked example: it
is a hand-rolled markdown converter rather than a markdown library, which is
safe because it only ever parses markdown this app generated from a fixed
prompt — a known, narrow grammar, not arbitrary input.

## Hard constraint 2: don't change default behavior

People run this against real repositories with real API keys and real rate
limits. New features are opt-in. A change that makes the default path send more
tokens, make more API calls, or write to a different endpoint needs to be behind
a setting that is off by default.

## The detailed-analysis tradeoff

The one setting worth understanding before you touch `core/ai.js`.

Classification runs in one of two modes, chosen by whether the caller passes
`fileContext` into `classifyChanges()`:

| | Default (off) | Detailed analysis (on) |
|---|---|---|
| Prompt | `CLASSIFY_SYSTEM_PROMPT` | `CLASSIFY_SYSTEM_PROMPT_DIFF_AWARE` |
| Input | Commit messages only | Commit messages **plus file diffs** |
| Extra input tokens | none | roughly 10-20k per run |
| Output budget | 2000 tokens | 8000 tokens |
| Entries | Roughly one per commit | Up to 6 per commit, split by what the diffs show |
| Quality | As good as the commit messages | Accurate even when a message is `wip` or `fix stuff` |

Detailed mode is genuinely better output. It is off by default because it can
exhaust a free-tier API key in a handful of runs, and the tool should work on a
free key out of the box.

The token cost is bounded on purpose, and the budgeting logic in
`core/github.js` is load-bearing:

- `TOTAL_PATCH_BUDGET` (60,000 chars) caps the whole payload regardless of how
  large the underlying diff is.
- Per-file caps (`MAX_PATCH_CHARS`, `MAX_PATCH_LINES`) and `MAX_FILES` bound
  each entry, and the per-file cap is divided across the files that will
  actually use it so one large file cannot starve the rest.
- `GENERATED_PATTERNS` keeps lockfiles, build output and vendored code from
  spending patch budget. They are still listed by name so nothing is hidden
  from the model, but they get no diff.
- `truncatePatch()` cuts on `@@` hunk boundaries rather than character offsets,
  because several whole small hunks are more useful to the model than the first
  3000 characters of one hunk.

If you raise any of those limits, say so explicitly in the PR — it is a direct
cost increase for every user who has the toggle on. `test/test-diff.js` covers
this logic; extend it rather than working around it.

## Pull requests

- Run `node test/run-all.js` before pushing.
- Match the surrounding style. This codebase comments the *why*, not the *what* —
  if a line looks odd and the reason isn't obvious from the code, leave a note.
- Keep unrelated changes out. In particular, `dist/` is gitignored; if it shows
  up in your diff, something has gone wrong.
- New behavior needs a test. The suites are plain Node, so this is cheap.

## Reporting security issues

Please do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
