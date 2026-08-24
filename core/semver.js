// Semantic version suggestion, derived from data the classification pipeline
// already produces — no AI call, no network, no dependencies. Lives in core/
// so the desktop app and the GitHub Action share one implementation.

// Optional leading "v", then MAJOR.MINOR.PATCH. Anything else is rejected
// rather than guessed at: a wrong version suggestion is worse than none.
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(versionString) {
  if (typeof versionString !== "string") return null;
  const match = VERSION_PATTERN.exec(versionString.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

// breaking -> major, feat -> minor, everything else -> patch. An empty range
// still returns "patch" rather than null: a docs-only release is a real
// release, and callers should never have to handle a missing bump.
function suggestBump(classifiedChanges) {
  const changes = Array.isArray(classifiedChanges) ? classifiedChanges : [];
  if (changes.some((c) => c && c.category === "breaking")) return "major";
  if (changes.some((c) => c && c.category === "feat")) return "minor";
  return "patch";
}

function countBy(changes, category) {
  return changes.filter((c) => c && c.category === category).length;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// `aiBump` is the model's own recommendation from classifyChanges (it sees every
// commit and diff, so it can weigh "major feature addition" in a way counting
// categories cannot). When present and valid it WINS; the category rule below is
// the fallback for when the model didn't answer or the call was skipped.
function nextVersion(currentVersionString, classifiedChanges, aiBump = null) {
  const parsed = parseVersion(currentVersionString);
  if (!parsed) {
    return {
      current: currentVersionString,
      bump: null,
      suggested: null,
      reasoning: `Could not parse a version from '${currentVersionString}' — expected MAJOR.MINOR.PATCH.`
    };
  }

  const changes = Array.isArray(classifiedChanges) ? classifiedChanges : [];
  const aiDecided = Boolean(aiBump && ["major", "minor", "patch"].includes(aiBump.bump));
  const bump = aiDecided ? aiBump.bump : suggestBump(changes);
  const breakingCount = countBy(changes, "breaking");
  const featCount = countBy(changes, "feat");

  // Preserve the caller's "v" convention rather than imposing one.
  const prefix = String(currentVersionString).trim().startsWith("v") ? "v" : "";
  let { major, minor, patch } = parsed;

  // semver's 0.x.y convention: pre-1.0 releases carry no stability guarantee,
  // so breaking changes are expected and increment MINOR, not MAJOR. Bumping
  // 0.4.2 to 1.0.0 would silently declare the project stable — a much larger
  // claim than the change itself justifies. See semver.org clause 4.
  // The 0.x guard applies only to the mechanical fallback. When the model has
  // explicitly judged the release, its call is honoured as-is — overriding it
  // here would make "the AI decides the version" quietly untrue.
  const zeroVer = major === 0;
  const downgradedByZeroVer = bump === "major" && zeroVer && !aiDecided;
  const effectiveBump = downgradedByZeroVer ? "minor" : bump;

  if (effectiveBump === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (effectiveBump === "minor") {
    minor += 1;
    patch = 0; // a minor bump resets patch
  } else {
    patch += 1;
  }

  let reasoning;
  if (aiDecided) {
    reasoning = aiBump.reasoning
      ? `${aiBump.reasoning} (AI-recommended ${effectiveBump} bump.)`
      : `AI recommended a ${effectiveBump} version bump.`;
  } else if (downgradedByZeroVer) {
    reasoning = `${plural(breakingCount, "breaking change")} detected, but this is a 0.x release — suggesting a minor bump instead of major.`;
  } else if (breakingCount > 0) {
    reasoning = `${plural(breakingCount, "breaking change")} detected — suggesting a major version bump.`;
  } else if (featCount > 0) {
    reasoning = `${plural(featCount, "new feature")} — suggesting a minor version bump.`;
  } else if (changes.length === 0) {
    reasoning = "No classified changes — defaulting to a patch bump.";
  } else {
    reasoning = "No breaking or feature changes — patch bump only.";
  }

  return {
    current: currentVersionString,
    bump: effectiveBump,
    suggested: `${prefix}${major}.${minor}.${patch}`,
    reasoning,
    decidedBy: aiDecided ? "ai" : "rules"
  };
}

module.exports = { parseVersion, suggestBump, nextVersion };
