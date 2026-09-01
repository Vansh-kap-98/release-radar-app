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

Never invent a change not in the input.

VERSION RECOMMENDATION
Also decide the version bump for this release, as "major" | "minor" | "patch":
- "major": a breaking change, OR a MAJOR feature addition — a significant new
  capability, a new surface area, or an architectural shift that changes what
  the software fundamentally does.
- "minor": smaller new features, enhancements, and additive improvements that
  do not change existing behaviour.
- "patch": bug fixes, documentation, and chores only — nothing new.
Judge the release as a whole, weighing the size of what actually changed rather
than counting entries. One substantial new capability outranks many small fixes.
Give a one-sentence reason a maintainer would accept.

Return ONLY valid JSON, no prose and no markdown fencing, shaped exactly:
{"changes": [ ...the objects above... ], "version": {"bump": "major|minor|patch", "reasoning": "one sentence"}}`;

// The diff-aware prompt. This is LIVE: classifyChanges() selects it whenever a
// caller passes `fileContext`, which happens when "detailed analysis" is on in
// the desktop app or `detailed-analysis: true` in the Action.
//
// It defaults OFF for cost, not because it is unfinished. Sending file diffs
// adds roughly 10-20k input tokens per run and needs an 8000-token output
// budget instead of 2000, which is enough to exhaust a free-tier key in a few
// runs. The commit-messages-only prompt above stays the default so the tool
// works on a free key; users with headroom opt in and get titles derived from
// the actual code change rather than the commit message wording.
const CLASSIFY_SYSTEM_PROMPT_DIFF_AWARE = `You are a changelog classification engine. You will receive a JSON object with:
- "commits": an array of commits (sha, message, author) for the whole range.
- "files": an array of file-level changes for the whole range (filename, status, additions, deletions, and usually a truncated unified diff "patch"). Some entries have no patch and carry a "note" instead.
- "diffCoverage": metadata about what was left out of "files".
- "commitCoverage" (when present): says the commit list itself is incomplete. If
  it is present, do NOT describe the result as the complete set of changes.

The commits and files are NOT paired one-to-one — the files describe the aggregate diff across the whole range. Use them together.

Output an array of CHANGE entries. Each entry has:
- "sha": the commit it came from (must be one of the input shas)
- "title": a specific, concrete one-line description
- "category": one of "feat", "fix", "breaking", "docs", "chore"
- "scope" (optional): the affected area, e.g. "auth", "picker", "api"

Entries are NOT one-per-commit. A single commit often bundles several distinct
user-facing changes — especially when its message is something like "features 1
2 3 added" or "frontend". When the diffs show several separable changes in one
commit, emit a SEPARATE entry for each one, reusing that commit's sha. Up to 6
entries per commit. Conversely, if several commits are clearly one change
(a fix and its follow-up typo), one entry is fine.

Using the diffs:
- Use the file diffs to understand the actual code impact of each commit, not just the commit message wording.
- If a commit message is vague ("fix stuff", "wip", "updates"), describe what the diff shows instead.
- If a commit message is already clear and its diff is trivial, keep the title concise — do NOT pad it with invented detail.
- Do not invent details not visible in either the messages or the diffs.
- If a file is listed but its patch was truncated or omitted (see its "note", or "diffCoverage"), you may say that file changed, but never describe what changed inside a diff you cannot see.
- Files that look generated (lockfiles, build output, vendored dependencies) are normally "chore" and need no deep analysis.
- Be concrete. Name the feature, module, command, or UI surface the diff shows —
  "Commit range can now be picked by clicking two rows in the commit list" beats
  "improve UI". Prefer the reader's vocabulary over file paths, but a specific
  filename is better than a vague abstraction.
- Say what changed for a user of the software, not what the patch did mechanically.
  "Added retry with exponential backoff on rate-limited AI requests" beats
  "modified callModel function".
- Keep every title under 25 words. Specific, not exhaustive.

Category rules:
- "breaking": contains "BREAKING CHANGE", a "!" after the type/scope, or explicitly describes a removed/incompatible change.
- "feat": introduces new functionality.
- "fix": fixes a bug or defect.
- "docs": documentation-only changes.
- "chore": anything else, or anything too vague to confidently classify.

Every "sha" MUST be one of the input commit shas — never invent one. Aim to
surface every distinct change the diffs reveal; a large refactor commit should
not collapse into a single vague line.

VERSION RECOMMENDATION
Also decide the version bump for this release, as "major" | "minor" | "patch":
- "major": a breaking change, OR a MAJOR feature addition — a significant new
  capability, a new surface area, or an architectural shift that changes what
  the software fundamentally does.
- "minor": smaller new features, enhancements, and additive improvements that
  do not change existing behaviour.
- "patch": bug fixes, documentation, and chores only — nothing new.
Judge the release as a whole, weighing the size of what actually changed rather
than counting entries. One substantial new capability outranks many small fixes.
Give a one-sentence reason a maintainer would accept.

Return ONLY valid JSON, no prose and no markdown fencing, shaped exactly:
{"changes": [ ...the objects above... ], "version": {"bump": "major|minor|patch", "reasoning": "one sentence"}}`;

const FORMAT_SYSTEM_PROMPT = `You are a release notes formatter. You will receive a JSON array of classified changes (title, category, optional scope) plus a repo name and range.

Produce clean markdown with this structure, skipping any section with zero entries:

## <repo> — <range>

### Breaking Changes
### Features
### Fixes
### Documentation
### Chores

One bullet per entry: "- <title>" (prefix "**<scope>:**" if scope is present). No commentary beyond this structure. Output markdown only.`;

// Model IDs move fast; keep them together so swapping one is a single edit.
const MODELS = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  groq: "openai/gpt-oss-120b",
  google: "gemini-3.6-flash"
};

// Each provider only describes HOW to shape a request and read a response.
// Retry/backoff lives once in callModel() below, so it applies identically
// to every provider instead of being duplicated per branch.
const PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    buildRequest({ apiKey, system, user, maxTokens }) {
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: MODELS.anthropic,
          // Anthropic requires max_tokens. Detailed mode needs more room:
          // longer titles otherwise truncate the JSON array mid-response.
          max_tokens: maxTokens ?? 2000,
          system,
          messages: [{ role: "user", content: user }]
        })
      };
    },
    extractText: (data) => data.content.map((b) => b.text || "").join("")
  },

  openai: {
    label: "OpenAI",
    buildRequest({ apiKey, system, user }) {
      return {
        url: "https://api.openai.com/v1/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: MODELS.openai,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      };
    },
    extractText: (data) => data.choices[0].message.content
  },

  groq: {
    // Groq exposes an OpenAI-compatible endpoint — same shape, different
    // base URL and model name.
    label: "Groq",
    buildRequest({ apiKey, system, user }) {
      return {
        url: "https://api.groq.com/openai/v1/chat/completions",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: MODELS.groq,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user }
          ]
        })
      };
    },
    extractText: (data) => data.choices[0].message.content
  },

  google: {
    // Gemini's REST shape differs from the OpenAI-style providers: the system
    // prompt is its own field, messages are "contents" with "parts", and the
    // key goes in a header rather than the URL (keeping it out of logs).
    label: "Google Gemini",
    buildRequest({ apiKey, system, user, maxTokens }) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.google}:generateContent`,
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            maxOutputTokens: maxTokens ?? 2000,
            // Gemini spends maxOutputTokens on internal reasoning before
            // emitting any text, which truncates the JSON array mid-response
            // on a mechanical shaping task like this. Gemini 3.x replaced
            // 2.5's `thinkingBudget` with `thinkingLevel`; "minimal" is the
            // lowest accepted value ("none"/"off" are rejected) and measures
            // at zero thought tokens.
            thinkingConfig: { thinkingLevel: "minimal" }
          }
        })
      };
    },
    extractText: (data) => {
      const candidate = data.candidates?.[0];
      if (!candidate) {
        // Safety filters and prompt blocks return no candidate at all.
        const reason = data.promptFeedback?.blockReason;
        throw new Error(
          reason
            ? `Google Gemini returned no content (blocked: ${reason}).`
            : "Google Gemini returned no content."
        );
      }
      return (candidate.content?.parts ?? []).map((part) => part.text || "").join("");
    }
  }
};

const MAX_RETRIES = 3; // 1s, 2s, 4s — 4 total requests worst case
const MAX_BACKOFF_MS = 60000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// `retry-after` may be seconds ("30") or an HTTP date. Handle both, and
// never honour an absurdly long value.
function parseRetryAfter(res) {
  const header = res.headers?.get?.("retry-after");
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.min(seconds * 1000, MAX_BACKOFF_MS);

  const timestamp = Date.parse(header);
  if (!Number.isNaN(timestamp)) {
    return Math.min(Math.max(timestamp - Date.now(), 0), MAX_BACKOFF_MS);
  }
  return null;
}

// Provider-agnostic: builds the request via the provider spec, then handles
// 429s with retry-after or exponential backoff. `onRetry` lets the caller
// surface "retrying in Xs" to the UI.
async function callModel({ provider, apiKey, system, user, maxTokens, onRetry }) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`Unknown AI provider: ${provider}`);

  const req = spec.buildRequest({ apiKey, system, user, maxTokens });

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });

    // 429 is rate limiting; 5xx is the provider being transiently overloaded
    // (Gemini returns 503 "high demand" under load). Both are worth retrying.
    const retryable = res.status === 429 || res.status >= 500;

    if (retryable) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(
          res.status === 429
            ? `Rate limit reached on ${spec.label}. Try again in a minute, or switch providers in Settings.`
            : `${spec.label} is temporarily unavailable (${res.status}). Try again shortly, or switch providers in Settings.`
        );
      }
      const waitMs = parseRetryAfter(res) ?? Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
      onRetry?.({ provider: spec.label, attempt: attempt + 1, maxRetries: MAX_RETRIES, waitMs });
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) throw new Error(`${spec.label} API error: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return spec.extractText(data);
  }
}

function stripCodeFence(text) {
  return text.trim().replace(/^```[a-z]*\n?/i, "").replace(/```$/, "").trim();
}

// `fileContext` is the summarized, truncated diff from github.js. Callers
// pass it only when the user enables "detailed analysis" — passing null keeps
// the original, cheap, commit-messages-only behavior byte for byte.
//
// Returns { changes, versionBump, diffMeta }. The version bump is decided by the
// model in this SAME call — it already has every commit and diff in front of it,
// so the recommendation costs no extra request and no extra rate-limit budget.
//
// `diffMeta` reports what was actually sent in detailed mode
// ({ filesIncluded, filesOmitted, filesWithoutPatch, totalDiffChars }) and is
// null otherwise. It is computed here rather than by each caller so the desktop
// app and the GitHub Action report identical numbers from one implementation.
async function classifyChanges(commits, fileContext, { provider, apiKey, onRetry } = {}) {
  let system = CLASSIFY_SYSTEM_PROMPT;
  let payload = commits;
  let maxTokens = 2000;
  let diffMeta = null;

  if (fileContext) {
    const { files = [], omittedFileCount = 0, responseCapped = false } = fileContext;

    system = CLASSIFY_SYSTEM_PROMPT_DIFF_AWARE;
    maxTokens = 8000;
    diffMeta = {
      filesIncluded: files.length,
      filesOmitted: omittedFileCount,
      filesWithoutPatch: files.filter((f) => !f.patch).length,
      totalDiffChars: files.reduce((n, f) => n + (f.patch?.length ?? 0), 0)
    };
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
    maxTokens,
    onRetry,
    user: JSON.stringify(payload, null, 2)
  });

  let parsed;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("AI classification response wasn't valid JSON — try again.");
  }

  // The prompt asks for {changes, version}, but models sometimes answer with a
  // bare array. Accept both rather than failing a whole run over the wrapper.
  const entries = Array.isArray(parsed) ? parsed : parsed && parsed.changes;
  if (!Array.isArray(entries)) {
    throw new Error("AI classification response wasn't in the expected shape — try again.");
  }

  // Guardrail: every entry must trace back to a real commit in the range.
  const knownShas = new Set(commits.map((c) => c.sha));
  const changes = entries.filter((entry) => entry && knownShas.has(entry.sha));

  // The model's own bump call. Only accepted when it is one of the three valid
  // values — anything else falls back to the deterministic rule in semver.js.
  let versionBump = null;
  const v = !Array.isArray(parsed) && parsed ? parsed.version : null;
  if (v && ["major", "minor", "patch"].includes(v.bump)) {
    versionBump = {
      bump: v.bump,
      reasoning: typeof v.reasoning === "string" ? v.reasoning.trim().slice(0, 300) : ""
    };
  }

  return { changes, versionBump, diffMeta };
}

async function formatReleaseNotes(changes, repo, range, { provider, apiKey, onRetry } = {}) {
  const raw = await callModel({
    provider,
    apiKey,
    onRetry,
    system: FORMAT_SYSTEM_PROMPT,
    user: JSON.stringify({ repo, range, changes }, null, 2)
  });
  return stripCodeFence(raw);
}

module.exports = { classifyChanges, formatReleaseNotes, callModel };