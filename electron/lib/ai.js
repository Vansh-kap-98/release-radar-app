// These two functions do what the two Lamatic LLM nodes used to do,
// just calling the AI provider's API directly with the user's own key
// (BYOK model). Supports Anthropic and OpenAI; add more providers by
// adding another branch in callModel().

const CLASSIFY_SYSTEM_PROMPT = `You are a changelog classification engine. You will receive a JSON array of commits.

For each entry, output an object with:
- "sha"
- "title" (cleaned-up one-line summary, based only on the original message)
- "category": one of "feat", "fix", "breaking", "docs", "chore"
- "scope" (optional, only if clearly indicated, e.g. "feat(auth): ...")

Rules:
- "breaking": contains "BREAKING CHANGE", a "!" after the type/scope, or explicitly describes a removed/incompatible change.
- "feat": introduces new functionality.
- "fix": fixes a bug or defect.
- "docs": documentation-only changes.
- "chore": anything else, or anything too vague to confidently classify.

Never invent a change not in the input. Return ONLY valid JSON: an array of the objects above. No prose, no markdown fencing.`;

// PARKED (diff-aware changelog): the prompt below is the finished diff-aware
// version — kept as a live constant rather than a commented-out block so it
// stays readable and editable. Unused until the feature is switched back on;
// see the note at the bottom of README.md for how to re-enable.
const CLASSIFY_SYSTEM_PROMPT_DIFF_AWARE = `You are a changelog classification engine. You will receive a JSON object with:
- "commits": an array of commits (sha, message, author) for the whole range.
- "files": an array of file-level changes for the whole range (filename, status, additions, deletions, and usually a truncated unified diff "patch"). Some entries have no patch and carry a "note" instead.
- "diffCoverage": metadata about what was left out of "files".

The commits and files are NOT paired one-to-one — the files describe the aggregate diff across the whole range. Use them together.

For each COMMIT, output an object with:
- "sha"
- "title": a clear, specific one-line summary
- "category": one of "feat", "fix", "breaking", "docs", "chore"
- "scope" (optional, only if clearly indicated, e.g. "feat(auth): ...")

Using the diffs:
- Use the file diffs to understand the actual code impact of each commit, not just the commit message wording.
- If a commit message is vague ("fix stuff", "wip", "updates"), describe what the diff shows instead.
- If a commit message is already clear and its diff is trivial, keep the title concise — do NOT pad it with invented detail.
- Do not invent details not visible in either the messages or the diffs.
- If a file is listed but its patch was truncated or omitted (see its "note", or "diffCoverage"), you may say that file changed, but never describe what changed inside a diff you cannot see.
- Files that look generated (lockfiles, build output, vendored dependencies) are normally "chore" and need no deep analysis.
- Keep every title under 20 words — this is a changelog, not a commit-by-commit code review.

Category rules:
- "breaking": contains "BREAKING CHANGE", a "!" after the type/scope, or explicitly describes a removed/incompatible change.
- "feat": introduces new functionality.
- "fix": fixes a bug or defect.
- "docs": documentation-only changes.
- "chore": anything else, or anything too vague to confidently classify.

Output exactly one object per commit in "commits" — never more, never fewer, and never a sha that wasn't in the input. Return ONLY valid JSON: an array of the objects above. No prose, no markdown fencing.`;

const FORMAT_SYSTEM_PROMPT = `You are a release notes formatter. You will receive a JSON array of classified changes (title, category, optional scope) plus a repo name and range.

Produce clean markdown with this structure, skipping any section with zero entries:

## <repo> — <range>

### Breaking Changes
### Features
### Fixes
### Documentation
### Chores

One bullet per entry: "- <title>" (prefix "**<scope>:**" if scope is present). No commentary beyond this structure. Output markdown only.`;

async function callModel({ provider, apiKey, system, user }) {
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        // Back to 2000 while diff-aware is parked — max_tokens counts toward
        // Anthropic's rate-limit budget. Raise this to ~8000 when re-enabling
        // diffs: the longer titles otherwise truncate the JSON mid-array.
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: user }]
      })
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.content.map((b) => b.text || "").join("");
  }

  if (provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (provider === "groq") {
    // Groq exposes an OpenAI-compatible endpoint, so this is nearly
    // identical to the "openai" branch above — just a different base
    // URL, key, and model name.
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "openai/gpt-oss-120b",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    if (!res.ok) throw new Error(`Groq API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

function stripCodeFence(text) {
  return text.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
}

// `fileContext` is the summarized, truncated diff from github.js. It is
// currently always null (feature parked — see README), so classification runs
// on commit messages alone, exactly as it did before.
async function classifyChanges(commits, fileContext, { provider, apiKey }) {
  let system = CLASSIFY_SYSTEM_PROMPT;
  let payload = commits;

  // PARKED (diff-aware changelog): this block activates automatically once
  // github.js starts passing a real fileContext again — no other edits needed.
  if (fileContext) {
    const { files = [], omittedFileCount = 0, responseCapped = false } = fileContext;

    system = CLASSIFY_SYSTEM_PROMPT_DIFF_AWARE;
    payload = {
      commits,
      files,
      diffCoverage: {
        filesShown: files.length,
        filesOmitted: omittedFileCount,
        responseCappedByGithub: responseCapped,
        note: [
          omittedFileCount > 0
            ? `${omittedFileCount} less-changed file(s) are not listed here.`
            : null,
          responseCapped
            ? "GitHub caps the compare response at 300 files, so this file list may be incomplete — do not describe it as the complete set of changes."
            : null,
          "Patches may be truncated; never describe changes you cannot see in the patch text."
        ]
          .filter(Boolean)
          .join(" ")
      }
    };
  }

  const raw = await callModel({
    provider,
    apiKey,
    system,
    user: JSON.stringify(payload, null, 2)
  });

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("AI classification response wasn't valid JSON — try again.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI classification response wasn't a JSON array — try again.");
  }

  // Guardrail: every entry must trace back to a real commit in the range.
  const knownShas = new Set(commits.map((c) => c.sha));
  return parsed.filter((entry) => entry && knownShas.has(entry.sha));
}

async function formatReleaseNotes(changes, repo, range, { provider, apiKey }) {
  const raw = await callModel({
    provider,
    apiKey,
    system: FORMAT_SYSTEM_PROMPT,
    user: JSON.stringify({ repo, range, changes }, null, 2)
  });
  return stripCodeFence(raw);
}

module.exports = { classifyChanges, formatReleaseNotes };