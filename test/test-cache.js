// Exercises the cache logic in main.js by replicating its key strategy and
// verifying the handler body's behavior via a stubbed electron module.
const Module = require("module");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

const handlers = {};
const sent = [];

// Stub electron + the store so main.js can be required outside Electron.
const origResolve = Module._resolveFilename;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") {
    return {
      app: { whenReady: () => Promise.resolve({ then: () => {} }), on: () => {}, quit: () => {}, getPath: () => require("os").tmpdir() },
      BrowserWindow: Object.assign(function () { return { loadURL(){}, loadFile(){}, webContents:{openDevTools(){}} }; }, { getAllWindows: () => [1], fromWebContents: () => null }),
      dialog: { showSaveDialog: async (...a) => (global.__saveDialog || (async () => ({ canceled: true })))(...a) },
      ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }
    };
  }
  if (request.includes("lib/store")) {
    return {
      getSecret: (k) => ({ githubToken: "gh", aiProvider: "anthropic", aiApiKey: "ai" }[k] ?? null),
      setSecret: () => {},
      getAll: () => ({})
    };
  }
  return origLoad.apply(this, arguments);
};

let githubCalls = 0;
let aiCalls = 0;

const mainPath = "../electron/main.js";
const githubPath = require.resolve(require("path").join(__dirname, "..", "core/github.js"));
const aiPath = require.resolve(require("path").join(__dirname, "..", "core/ai.js"));
const historyPath = require.resolve(require("path").join(__dirname, "..", "electron/lib/history.js"));

let historyAdds = 0;
require.cache[historyPath] = {
  id: historyPath, filename: historyPath, loaded: true, exports: {
    listHistory: () => [],
    addHistoryEntry: (e) => { historyAdds++; return e; },
    deleteHistoryEntry: () => {},
    clearHistory: () => {}
  }
};

require.cache[githubPath] = {
  id: githubPath, filename: githubPath, loaded: true, exports: {
    fetchChangeRange: async () => { githubCalls++; return { commits: [{ sha: "a", message: "m" }], fileContext: { files: [], omittedFileCount: 0, responseCapped: false }, empty: false }; },
    listCommits: async () => ({ commits: [], hasNextPage: false }),
    getRepoDefaults: async () => ({ defaultBranch: "main", latestTag: null })
  }
};
require.cache[aiPath] = {
  id: aiPath, filename: aiPath, loaded: true, exports: {
    classifyChanges: async () => { aiCalls++; return { changes: [{ sha: "a", title: "t", category: "feat" }], versionBump: { bump: "major", reasoning: "Adds a major new capability." } }; },
    formatReleaseNotes: async () => "md"
  }
};

require(mainPath);

const fakeEvent = { sender: { isDestroyed: () => false, send: (ch, payload) => sent.push(payload) } };

(async () => {
  const handler = handlers["release-radar:fetch-changes"];
  check("fetch-changes handler registered", typeof handler === "function");

  console.log("\n-- first call hits GitHub + AI --");
  const r1 = await handler(fakeEvent, { repo: "a/b", fromRef: "v1", toRef: "main", detailed: false });
  check("github called once", githubCalls === 1, githubCalls);
  check("ai called once", aiCalls === 1, aiCalls);
  check("not flagged cached", !r1.cached);

  console.log("\n-- identical repeat is served from cache --");
  const r2 = await handler(fakeEvent, { repo: "a/b", fromRef: "v1", toRef: "main", detailed: false });
  check("no second AI call", aiCalls === 1, aiCalls);
  check("no second GitHub call", githubCalls === 1, githubCalls);
  check("flagged cached", r2.cached === true);
  check("same changes returned", JSON.stringify(r2.changes) === JSON.stringify(r1.changes));

  console.log("\n-- changing detailed toggle bypasses cache --");
  await handler(fakeEvent, { repo: "a/b", fromRef: "v1", toRef: "main", detailed: true });
  check("AI called again for detailed=true", aiCalls === 2, aiCalls);

  console.log("\n-- changing a ref bypasses cache --");
  await handler(fakeEvent, { repo: "a/b", fromRef: "v2", toRef: "main", detailed: false });
  check("AI called again for new ref", aiCalls === 3, aiCalls);

  console.log("\n-- force:true bypasses cache (Regenerate) --");
  const before = aiCalls;
  await handler(fakeEvent, { repo: "a/b", fromRef: "v1", toRef: "main", detailed: false });
  check("cached repeat made no call", aiCalls === before, aiCalls);
  const r5 = await handler(fakeEvent, { repo: "a/b", fromRef: "v1", toRef: "main", detailed: false, force: true });
  check("force re-ran the pipeline", aiCalls === before + 1, aiCalls);
  check("force result not flagged cached", !r5.cached);
  await handler(fakeEvent, { repo: "a/b", fromRef: "v1", toRef: "main", detailed: false });
  check("cache repopulated after force", aiCalls === before + 1, aiCalls);

  console.log("\n-- version suggestion rides along with the classification --");
  {
    const r = await handler(fakeEvent, { repo: "a/b", fromRef: "v1.2.0", toRef: "main", detailed: false, force: true });
    check("suggestion present", Boolean(r.versionSuggestion), JSON.stringify(r.versionSuggestion));
    check("AI bump wins over the category rule", r.versionSuggestion.bump === "major", r.versionSuggestion.bump);
    check("suggested version computed from fromRef", r.versionSuggestion.suggested === "v2.0.0", r.versionSuggestion.suggested);
    check("AI reasoning surfaced", /major new capability/i.test(r.versionSuggestion.reasoning), r.versionSuggestion.reasoning);
    check("labelled as AI-decided", r.versionSuggestion.decidedBy === "ai", r.versionSuggestion.decidedBy);

    // A raw SHA is not a version: degrade to no suggestion, never a wrong one.
    const sha = await handler(fakeEvent, { repo: "a/b", fromRef: "cf5e06dc2dfe", toRef: "main", detailed: false, force: true });
    check("SHA range yields no suggested version", sha.versionSuggestion.suggested === null, sha.versionSuggestion.suggested);
    check("SHA range still returns changes (flow not blocked)", sha.changes.length === 1);
    check("SHA range explains why", /Could not parse a version/.test(sha.versionSuggestion.reasoning), sha.versionSuggestion.reasoning);
  }


  console.log("\n-- status events emitted --");
  const phases = sent.map((s) => s.phase);
  check("emitted github phase", phases.includes("github"), phases.join(","));
  check("emitted ai phase", phases.includes("ai"), phases.join(","));
  check("emitted idle phase", phases.includes("idle"), phases.join(","));

  console.log("\n-- publish saves to history exactly once --");
  const publish = handlers["release-radar:publish"];
  historyAdds = 0;
  const p1 = await publish(fakeEvent, {
    repo: "a/b", range: "v1...main", changes: [], publishTarget: "markdown-only", confirmed: false, detailed: true
  });
  check("generation saved to history", historyAdds === 1, historyAdds);
  check("markdown returned", p1.markdown === "md");

  // Confirm step reuses the reviewed markdown, so it must NOT double-save.
  await publish(fakeEvent, {
    repo: "a/b", range: "v1...main", changes: [], markdown: "md",
    publishTarget: "markdown-only", confirmed: true, detailed: true
  });
  check("confirm step did not save a duplicate", historyAdds === 1, historyAdds);

  console.log("\n-- export handlers (feature 6a) --");
  {
    const os = require("os"), pathMod = require("path"), fsSync = require("fs");
    const exportH = handlers["release-radar:export"];
    const saveH = handlers["release-radar:export-save"];
    check("export handler registered", typeof exportH === "function");
    check("export-save handler registered", typeof saveH === "function");

    const md = "## repo — v1\n\n### Features\n- **a**: did it\n";
    const html = await exportH(fakeEvent, { markdown: md, format: "html", title: "T" });
    check("html export is a full document", html.content.startsWith("<!doctype html>"), html.content.slice(0, 30));
    check("html export uses the title", /<title>T<\/title>/.test(html.content));
    check("html extension reported", html.extension === "html");

    const txt = await exportH(fakeEvent, { markdown: md, format: "text" });
    check("text export strips markdown", !/[#*]/.test(txt.content), txt.content);
    check("txt extension reported", txt.extension === "txt");

    const raw = await exportH(fakeEvent, { markdown: md, format: "markdown" });
    check("markdown export passes through unchanged", raw.content === md);

    let msg = null;
    try { await exportH(fakeEvent, { markdown: md, format: "pdf" }); } catch (e) { msg = e.message; }
    check("unknown format rejected", /Unknown export format: pdf/.test(msg), msg);

    msg = null;
    try { await exportH(fakeEvent, { markdown: "", format: "html" }); } catch (e) { msg = e.message; }
    check("empty markdown gives a readable error", /generate release notes first/.test(msg), msg);

    // Save: cancel path must not write anything
    global.__saveDialog = async () => ({ canceled: true });
    const cancelled = await saveH(fakeEvent, { markdown: md, format: "html" });
    check("cancelled save reports canceled", cancelled.canceled === true && cancelled.saved === false);

    // Save: happy path actually writes the converted content
    const target = pathMod.join(os.tmpdir(), `rr-export-${Date.now()}.html`);
    let seenOptions = null;
    global.__saveDialog = async (_win, options) => { seenOptions = options; return { canceled: false, filePath: target }; };
    const saved = await saveH(fakeEvent, { markdown: md, format: "html", defaultName: "CHANGELOG-v1.2.0" });
    check("save reports success and path", saved.saved === true && saved.path === target, JSON.stringify(saved));
    check("file written to disk", fsSync.existsSync(target));
    const onDisk = fsSync.readFileSync(target, "utf8");
    check("written file is converted HTML, not markdown", onDisk.includes("<h3>Features</h3>") && !onDisk.includes("### Features"), onDisk.slice(0, 60));
    check("default filename suggested with extension", /CHANGELOG-v1\.2\.0\.html$/.test(seenOptions.defaultPath), seenOptions.defaultPath);
    fsSync.unlinkSync(target);
    global.__saveDialog = null;
  }


  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
