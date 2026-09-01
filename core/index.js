// Release Radar core — the changelog pipeline with no Electron dependency.
//
// Everything here is plain Node using global fetch(), so the same code runs
// in the desktop app's main process AND in a GitHub Action on GitHub's
// runners. Anything needing Electron (encrypted key storage, IPC, windows)
// lives in ../electron and never leaks in here.

const { fetchChangeRange, listCommits, getRepoDefaults, listTags, findPreviousTag, summarizeFiles, truncatePatch, apiBase, webBase, DEFAULT_API_BASE_URL } = require("./github");
const { classifyChanges, formatReleaseNotes, callModel } = require("./ai");
const { parseVersion, suggestBump, nextVersion } = require("./semver");
const { markdownToHtml, markdownToPlainText } = require("./export");
const { publishGithubRelease, postToSlack, openChangelogPullRequest } = require("./publish");

module.exports = {
  // GitHub reads
  fetchChangeRange,
  listCommits,
  getRepoDefaults,
  listTags,
  findPreviousTag,
  summarizeFiles,
  truncatePatch,
  // GitHub host (GitHub Enterprise Server support)
  apiBase,
  webBase,
  DEFAULT_API_BASE_URL,
  // Version suggestion
  parseVersion,
  suggestBump,
  nextVersion,
  // Export formats
  markdownToHtml,
  markdownToPlainText,
  // AI
  classifyChanges,
  formatReleaseNotes,
  callModel,
  // Publishing
  publishGithubRelease,
  postToSlack,
  openChangelogPullRequest
};
