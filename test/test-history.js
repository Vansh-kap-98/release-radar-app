const Module = require("module");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

// In-memory stand-in for electron-store so this runs outside Electron.
const backing = {};
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "electron-store") {
    return function Store() {
      return {
        get: (k, d) => (k in backing ? backing[k] : d),
        set: (k, v) => { backing[k] = v; },
        delete: (k) => { delete backing[k]; }
      };
    };
  }
  return origLoad.apply(this, arguments);
};

const history = require("../electron/lib/history.js");

(async () => {
  console.log("-- empty state --");
  check("starts empty", history.listHistory().length === 0);

  console.log("\n-- adding entries --");
  const a = history.addHistoryEntry({ repo: "a/b", range: "v1...v2", markdown: "# one", detailed: false });
  await new Promise((r) => setTimeout(r, 5));
  const b = history.addHistoryEntry({ repo: "a/b", range: "v2...v3", markdown: "# two", detailed: true });
  check("two entries stored", history.listHistory().length === 2);
  check("newest first", history.listHistory()[0].id === b.id, history.listHistory()[0].markdown);
  check("ids are unique", a.id !== b.id);
  check("detailed flag persisted", history.listHistory()[0].detailed === true);
  check("createdAt is ISO", !Number.isNaN(Date.parse(history.listHistory()[0].createdAt)));
  check("markdown preserved", history.listHistory()[1].markdown === "# one");

  console.log("\n-- guards --");
  const none = history.addHistoryEntry({ repo: "a/b", range: "v1...v2", markdown: "" });
  check("empty markdown not stored", none === null && history.listHistory().length === 2);

  console.log("\n-- delete --");
  history.deleteHistoryEntry(a.id);
  check("entry removed", history.listHistory().length === 1);
  check("correct one survived", history.listHistory()[0].id === b.id);
  history.deleteHistoryEntry("does-not-exist");
  check("deleting unknown id is a no-op", history.listHistory().length === 1);

  console.log("\n-- cap at MAX_ENTRIES --");
  for (let i = 0; i < history.MAX_ENTRIES + 25; i++) {
    history.addHistoryEntry({ repo: "a/b", range: `r${i}`, markdown: `md ${i}` });
  }
  check(`capped at ${history.MAX_ENTRIES}`, history.listHistory().length === history.MAX_ENTRIES, history.listHistory().length);
  check("newest survived the cap", history.listHistory()[0].markdown === `md ${history.MAX_ENTRIES + 24}`);

  console.log("\n-- clear --");
  history.clearHistory();
  check("cleared", history.listHistory().length === 0);

  console.log("\n-- corrupt store recovers --");
  backing.entries = "not-an-array";
  check("non-array returns []", Array.isArray(history.listHistory()) && history.listHistory().length === 0);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
