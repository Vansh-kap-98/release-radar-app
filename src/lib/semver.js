// Feature 4: semantic version suggestion. Pure logic, no I/O — runs in the
// renderer directly since it doesn't need filesystem/network access.

const TAG_PATTERN = /^(v?)(\d+)\.(\d+)\.(\d+)/;

export function parseVersion(tag) {
  if (!tag) return null;
  const match = TAG_PATTERN.exec(tag.trim());
  if (!match) return null;
  const [, prefix, major, minor, patch] = match;
  return { prefix, major: Number(major), minor: Number(minor), patch: Number(patch) };
}

// breaking -> major, else feat -> minor, else -> patch. Docs/chore-only
// ranges still get a patch suggestion (they're a valid, if quiet, release).
export function suggestBump(changes) {
  if (!changes || changes.length === 0) return null;
  if (changes.some((c) => c.category === "breaking")) return "major";
  if (changes.some((c) => c.category === "feat")) return "minor";
  return "patch";
}

export function nextVersion(currentTag, bump) {
  if (!bump) return null;
  const parsed = parseVersion(currentTag);
  // No existing tag to bump from (first release) — default to v0.1.0/v0.0.1
  // style baseline rather than guessing at 1.0.0.
  const { prefix, major, minor, patch } = parsed ?? { prefix: "v", major: 0, minor: 0, patch: 0 };

  if (bump === "major") return `${prefix}${major + 1}.0.0`;
  if (bump === "minor") return `${prefix}${major}.${minor + 1}.0`;
  return `${prefix}${major}.${minor}.${patch + 1}`;
}
