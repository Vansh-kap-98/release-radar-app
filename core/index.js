// Release Radar core — the changelog pipeline with no Electron dependency.
//
// Everything here is plain Node using global fetch(), so the same code runs
// in the desktop app's main process AND in a GitHub Action on GitHub's
// runners. Anything needing Electron (encrypted key storage, IPC, windows)
// lives in ../electron and never leaks in here.

const { fetchChangeRange, listCommits, getRepoDefaults, listTags, findPreviousTag, summarizeFiles, truncatePatch } = require("./github");
const { classifyChanges, formatReleaseNotes, callModel } = require("./ai");
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
  // AI
  classifyChanges,
  formatReleaseNotes,
  callModel,
  // Publishing
  publishGithubRelease,
  postToSlack,
  openChangelogPullRequest
};
