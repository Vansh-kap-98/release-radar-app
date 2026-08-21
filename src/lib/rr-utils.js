// Version suggestion now lives in core/semver.js and is computed in the main
// process, so it is shared with the GitHub Action instead of duplicated here.
export function relativeTime(input) {
  const then = new Date(input).getTime();
  const diff = Math.max(0, Date.now() - then);
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export const shortRef = (ref) =>
  String(ref ?? "").replace(/\b[0-9a-f]{40}\b/g, (m) => m.slice(0, 7));

export const firstLine = (msg) => String(msg ?? "").split("\n")[0];

export const isValidRepo = (repo) => /^[\w.-]+\/[\w.-]+$/.test(String(repo).trim());

export const formatChars = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
