/**
 * Single data layer for Release Radar.
 * Every function talks to the Electron bridge (window.releaseRadar) when it is
 * available, and otherwise falls back to mock data so the UI works in a browser.
 */

const bridge = () => (typeof window !== "undefined" ? window.releaseRadar : null);

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

let mockSettings = {
  githubToken: true,
  aiApiKey: true,
  slackWebhookUrl: false,
  aiProviderValue: "anthropic",
};

const MOCK_COMMITS = [
  {
    sha: "9f2c1ab7d0e4f5a6b8c9d0e1f2a3b4c5d6e7f809",
    message: "feat(picker): allow selecting a commit range by clicking two rows",
    author: "dana",
    date: daysAgo(1),
  },
  {
    sha: "1b7e44c2a9d83f10c5b6a7e8d9f0a1b2c3d4e5f6",
    message: "wip",
    author: "marco",
    date: daysAgo(2),
  },
  {
    sha: "c30d9e81f4a2b6c7d8e9f0a1b2c3d4e5f6a7b809",
    message:
      "fix(api): retry AI provider requests on 429 with exponential backoff instead of failing the whole run immediately",
    author: "dana",
    date: daysAgo(3),
  },
  {
    sha: "77aa10bc93d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7",
    message: "docs: document the detailed analysis token cost",
    author: "priya",
    date: daysAgo(4),
  },
  {
    sha: "e51f8c04b7a3d2e1f0a9b8c7d6e5f4a3b2c1d0e9",
    message: "fix stuff",
    author: "marco",
    date: daysAgo(6),
  },
  {
    sha: "2d6b3af59c81e0d7f6a5b4c3d2e1f0a9b8c7d6e5",
    message: "chore(deps): bump electron to 31.2.0",
    author: "bot",
    date: daysAgo(8),
  },
  {
    sha: "aa04e7f21b93c6d5e4f3a2b1c0d9e8f7a6b5c4d3",
    message: "feat(slack): post formatted changelog blocks to a webhook",
    author: "priya",
    date: daysAgo(11),
  },
  {
    sha: "5c9d2e70a1b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0",
    message: "refactor!: drop support for the legacy config file format",
    author: "dana",
    date: daysAgo(14),
  },
  {
    sha: "b83f6a15d0c9e8f7a6b5c4d3e2f1a0b9c8d7e6f5",
    message: "fix(ui): commit list no longer collapses on long messages",
    author: "marco",
    date: daysAgo(17),
  },
  {
    sha: "40e1c9b8a7f6d5e4c3b2a1908f7e6d5c4b3a2918",
    message: "chore: release v1.2.0",
    author: "dana",
    date: daysAgo(21),
  },
  {
    sha: "cc72b0a95e8d7f6a5b4c3d2e1f0a9b8c7d6e5f43",
    message: "feat(cache): reuse classifications for an unchanged commit range",
    author: "priya",
    date: daysAgo(26),
  },
  {
    sha: "18f4d3c2b1a09e8d7c6b5a4f3e2d1c0b9a8f7e6d",
    message: "fix(github): handle repositories with no tags at all",
    author: "dana",
    date: daysAgo(30),
  },
];

const decorate = (c) => ({
  sha: c.sha,
  shortSha: c.sha.slice(0, 7),
  message: c.message,
  author: c.author,
  date: c.date,
  url: `https://github.com/acme/release-radar/commit/${c.sha}`,
});

let mockHistory = [
  {
    id: "h1",
    repo: "acme/release-radar",
    range: "40e1c9b8a7f6d5e4c3b2a1908f7e6d5c4b3a2918...9f2c1ab7d0e4f5a6b8c9d0e1f2a3b4c5d6e7f809",
    markdown:
      "## v1.3.0\n\n### Features\n- **picker**: select a commit range by clicking two rows\n- **slack**: post formatted changelog blocks to a webhook\n\n### Fixes\n- **api**: retry AI requests on 429 with backoff\n- **ui**: long commit messages no longer collapse the list\n",
    detailed: true,
    createdAt: daysAgo(1),
  },
  {
    id: "h2",
    repo: "acme/release-radar",
    range: "v1.1.0...v1.2.0",
    markdown:
      "## v1.2.0\n\n### Features\n- **cache**: reuse classifications for an unchanged commit range\n\n### Chores\n- bump electron to 31.2.0\n",
    detailed: false,
    createdAt: daysAgo(9),
  },
  {
    id: "h3",
    repo: "orbital/dashboard",
    range: "v0.8.2...v0.9.0",
    markdown:
      "## v0.9.0\n\n### Breaking changes\n- drop the legacy config file format\n\n### Fixes\n- **charts**: correct timezone handling on the weekly view\n",
    detailed: true,
    createdAt: daysAgo(20),
  },
  {
    id: "h4",
    repo: "orbital/cli",
    range: "18f4d3c2b1a09e8d7c6b5a4f3e2d1c0b9a8f7e6d...cc72b0a95e8d7f6a5b4c3d2e1f0a9b8c7d6e5f43",
    markdown: "## v0.4.1\n\n### Fixes\n- handle repositories with no tags at all\n",
    detailed: false,
    createdAt: daysAgo(41),
  },
];

/* ---------------------------------- status --------------------------------- */

const listeners = new Set();
const emit = (payload) => listeners.forEach((cb) => cb(payload));

export function onStatus(callback) {
  if (bridge()) return bridge().onStatus(callback);
  listeners.add(callback);
  return () => listeners.delete(callback);
}

async function simulateRun({ detailed }) {
  emit({ phase: "github" });
  await delay(700);
  emit({ phase: "ai", detailed, provider: mockSettings.aiProviderValue });
  await delay(detailed ? 1600 : 900);
  emit({ phase: "format" });
  await delay(400);
  emit({ phase: "idle" });
}

/* --------------------------------- settings -------------------------------- */

export async function getSettings() {
  if (bridge()) return bridge().getSettings();
  await delay(120);
  return { ...mockSettings };
}

export async function setSetting(key, value) {
  if (bridge()) return bridge().setSetting(key, value);
  await delay(120);
  if (key === "aiProvider") mockSettings.aiProviderValue = value;
  else mockSettings[key] = Boolean(value);
  return true;
}

/* ----------------------------------- repo ---------------------------------- */

export async function getRepoDefaults({ repo }) {
  if (bridge()) return bridge().getRepoDefaults({ repo });
  await delay(250);
  return { defaultBranch: "main", latestTag: repo.includes("cli") ? null : "v1.2.0" };
}

export async function listCommits({ repo, branch, page = 1 }) {
  if (bridge()) return bridge().listCommits({ repo, branch, page });
  await delay(400);
  const perPage = 8;
  const start = (page - 1) * perPage;
  const slice = MOCK_COMMITS.slice(start, start + perPage).map(decorate);
  return { commits: slice, hasNextPage: start + perPage < MOCK_COMMITS.length };
}

/* --------------------------------- changes --------------------------------- */

export async function fetchChanges({ repo, fromRef, toRef, detailed, force }) {
  if (bridge()) return bridge().fetchChanges({ repo, fromRef, toRef, detailed, force });
  await simulateRun({ detailed });

  if (fromRef === toRef) return { changes: [], empty: true };

  const changes = [
    {
      sha: "9f2c1ab7d0e4f5a6b8c9d0e1f2a3b4c5d6e7f809",
      title: detailed
        ? "Clicking two rows in the commit list now sets an inclusive range and highlights everything between them"
        : "Select a commit range by clicking two rows",
      category: "feat",
      scope: "picker",
    },
    {
      sha: "aa04e7f21b93c6d5e4f3a2b1c0d9e8f7a6b5c4d3",
      title: "Post formatted changelog blocks to a Slack webhook",
      category: "feat",
      scope: "slack",
    },
    {
      sha: "5c9d2e70a1b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0",
      title: "Legacy config file format is no longer read at startup",
      category: "breaking",
    },
    {
      sha: "c30d9e81f4a2b6c7d8e9f0a1b2c3d4e5f6a7b809",
      title: "Retry AI provider requests on 429 with exponential backoff",
      category: "fix",
      scope: "api",
    },
    {
      sha: "b83f6a15d0c9e8f7a6b5c4d3e2f1a0b9c8d7e6f5",
      title: "Long commit messages no longer collapse the commit list",
      category: "fix",
      scope: "ui",
    },
    {
      sha: "77aa10bc93d2e4f5a6b7c8d9e0f1a2b3c4d5e6f7",
      title: "Document the token cost of detailed analysis",
      category: "docs",
    },
    {
      sha: "2d6b3af59c81e0d7f6a5b4c3d2e1f0a9b8c7d6e5",
      title: "Bump Electron to 31.2.0",
      category: "chore",
      scope: "deps",
    },
  ];

  // Mirrors the shape main.js returns (it computes this via core/semver.js).
  // Deliberately crude here — this is mock data for browser preview only.
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(fromRef ?? "").trim());
  const versionSuggestion = m
    ? (() => {
        const prefix = String(fromRef).trim().startsWith("v") ? "v" : "";
        const [maj, min] = [Number(m[1]), Number(m[2])];
        return {
          current: fromRef,
          bump: "minor",
          suggested: `${prefix}${maj}.${min + 1}.0`,
          reasoning: "Adds two user-facing features without changing existing behaviour. (AI-recommended minor bump.)",
          decidedBy: "ai"
        };
      })()
    : {
        current: fromRef,
        bump: null,
        suggested: null,
        reasoning: `Could not parse a version from '${fromRef}' — expected MAJOR.MINOR.PATCH.`,
        decidedBy: "rules"
      };

  return {
    changes,
    empty: false,
    versionSuggestion,
    cached: !force && !detailed,
    ...(detailed
      ? {
          diffStats: {
            filesIncluded: 12,
            filesOmitted: 3,
            filesWithoutPatch: 1,
            totalDiffChars: 34210,
          },
        }
      : {}),
  };
}

/* --------------------------------- publish --------------------------------- */

function toMarkdown({ version, changes, detailed }) {
  const groups = [
    ["breaking", "Breaking changes"],
    ["feat", "Features"],
    ["fix", "Fixes"],
    ["docs", "Documentation"],
    ["chore", "Chores"],
  ];
  let out = `## ${version || "Unreleased"}\n`;
  for (const [key, label] of groups) {
    const rows = changes.filter((c) => c.category === key);
    if (!rows.length) continue;
    out += `\n### ${label}\n`;
    for (const c of rows) out += `- ${c.scope ? `**${c.scope}**: ` : ""}${c.title}\n`;
  }
  if (detailed) out += `\n_Generated with detailed diff analysis._\n`;
  return out;
}

export async function publish({
  repo,
  range,
  changes,
  markdown,
  publishTarget,
  confirmed,
  version,
  detailed,
}) {
  if (bridge())
    return bridge().publish({
      repo,
      range,
      changes,
      markdown,
      publishTarget,
      confirmed,
      version,
      detailed,
    });

  await delay(600);
  const md = markdown || toMarkdown({ version, changes: changes || [], detailed });

  if (publishTarget === "markdown-only") {
    mockHistory = [
      {
        id: `h${Date.now()}`,
        repo,
        range,
        markdown: md,
        detailed: Boolean(detailed),
        createdAt: new Date().toISOString(),
      },
      ...mockHistory,
    ];
    return { markdown: md, published: false };
  }

  if (!confirmed) return { markdown: md, published: false, needsConfirm: true };

  const urls = {
    "github-release": `https://github.com/${repo}/releases/tag/${version || "untagged"}`,
    slack: "https://acme.slack.com/archives/C012AB3CD/p1718000000",
    "pull-request": `https://github.com/${repo}/pull/482`,
  };
  mockHistory = [
    {
      id: `h${Date.now()}`,
      repo,
      range,
      markdown: md,
      detailed: Boolean(detailed),
      createdAt: new Date().toISOString(),
    },
    ...mockHistory,
  ];
  return { markdown: md, published: true, publishedUrl: urls[publishTarget] };
}

/* --------------------------------- export ---------------------------------- */

// The real conversion lives in core/export.js and runs in the main process.
// In browser preview there is no bridge, so we fall back to returning the raw
// markdown — enough to exercise the UI without duplicating the converters.
export async function exportNotes({ markdown, format, title }) {
  if (bridge()) return bridge().exportNotes({ markdown, format, title });
  await delay(120);
  return { content: markdown, format, extension: format === "html" ? "html" : "txt" };
}

export async function exportSave({ markdown, format, title, defaultName }) {
  if (bridge()) return bridge().exportSave({ markdown, format, title, defaultName });
  await delay(200);
  // No native save dialog in a browser — report the cancel path instead of
  // pretending a file was written.
  return { saved: false, canceled: true };
}

/* --------------------------------- history --------------------------------- */

export async function getHistory() {
  if (bridge()) return bridge().getHistory();
  await delay(200);
  return [...mockHistory];
}

export async function deleteHistoryEntry(id) {
  if (bridge()) return bridge().deleteHistoryEntry(id);
  await delay(150);
  mockHistory = mockHistory.filter((h) => h.id !== id);
  return [...mockHistory];
}

export async function clearHistory() {
  if (bridge()) return bridge().clearHistory();
  await delay(150);
  mockHistory = [];
  return [];
}
