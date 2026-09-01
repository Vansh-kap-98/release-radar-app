const { summarizeFiles, truncatePatch, fetchChangeRange } = require("../core/github.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

const hunky = (h, l) => Array.from({ length: h }, (_, i) =>
  `@@ -${i * 10},5 +${i * 10},6 @@\n` + Array.from({ length: l }, (_, j) => `+line ${j} ${"x".repeat(40)}`).join("\n")
).join("\n");

console.log("-- truncatePatch --");
const t1 = truncatePatch(hunky(40, 20));
const body1 = t1.replace(/\n\.\.\. \(diff truncated.*$/s, "");
check("char cap respected", body1.length <= 3000, body1.length);
check("line cap respected", body1.split("\n").length <= 200, body1.split("\n").length);
check("cuts on hunk/line boundary", body1.split("\n").filter(Boolean).every((l) => /^[+\-@ ]/.test(l)));
check("reports omitted lines", /diff truncated, \d+ more lines/.test(t1));
check("small patch untouched", truncatePatch("@@ -1,2 +1,3 @@\n+const a = 1;") === "@@ -1,2 +1,3 @@\n+const a = 1;");
check("empty patch safe", truncatePatch("") === "");
check("no hunk headers still bounded", truncatePatch("x".repeat(9000)).length <= 3100);

console.log("\n-- generated files never consume budget --");
const lock = summarizeFiles([
  { filename: "package-lock.json", status: "modified", changes: 90000, patch: hunky(50, 50) }
]);
check("lockfile diff omitted", lock.files[0].patch === null);
check("lockfile flagged generated", lock.files[0].generated === true);
check("lockfile still listed", lock.files[0].filename === "package-lock.json");
check("note explains omission", /generated\/build output/.test(lock.files[0].note));

const mixed = summarizeFiles([
  ...Array.from({ length: 29 }, (_, i) => ({ filename: `noise${i}/dist/bundle.js`, status: "modified", changes: 99999, patch: "@@\n+x" })),
  { filename: "src/real.js", status: "modified", changes: 3, patch: "@@ -1,2 +1,3 @@\n+const meaningful = 1;" },
  { filename: "yarn.lock", status: "modified", changes: 50000, patch: "@@\n+dep" }
]);
check("tiny source survives 29 huge generated files", Boolean(mixed.files.find((f) => f.filename === "src/real.js")));
check("source ranked first", mixed.files[0].filename === "src/real.js", mixed.files[0].filename);
check("source keeps its patch", mixed.files[0].patch.includes("meaningful"));
check("generated files carry no patch", mixed.files.filter((f) => f.generated).every((f) => f.patch === null));

console.log("\n-- caps and ceilings --");
const many = Array.from({ length: 80 }, (_, i) => ({ filename: `src/f${i}.js`, status: "modified", changes: 5000 - i, patch: hunky(60, 30) }));
const m = summarizeFiles(many);
check("at most 30 files", m.files.length === 30, m.files.length);
check("omitted count reported", m.omittedFileCount === 50, m.omittedFileCount);
const total = m.files.reduce((n, f) => n + (f.patch?.length ?? 0), 0);
check("combined patches <= 60k", total <= 60000, total);
check("one oversized file cannot bypass the ceiling",
  summarizeFiles([{ filename: "src/huge.js", status: "modified", changes: 9, patch: hunky(5000, 50) }]).files[0].patch.length <= 3000);

const capped = summarizeFiles(Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}.js`, status: "modified", changes: i, patch: "@@\n+x" })));
check("GitHub 300-file cap flagged", capped.responseCapped === true);

console.log("\n-- binary, renames, junk input --");
const odd = summarizeFiles([
  { filename: "assets/logo.png", status: "modified", changes: 0 },
  { filename: "src/new.js", previous_filename: "src/old.js", status: "renamed", changes: 0 }
]);
check("binary described, not fabricated", odd.files[0].patch === null && /no textual diff/.test(odd.files[0].note));
check("rename names both sides", odd.files[1].note === "renamed src/old.js → src/new.js", odd.files[1].note);
check("undefined input safe", summarizeFiles(undefined).files.length === 0);
check("null entries tolerated", summarizeFiles([null, undefined, { filename: "a.js", patch: "@@\n+x" }]).files.length === 1);
check("omitted count ignores junk", summarizeFiles([null, { filename: "a.js", patch: "@@\n+x" }]).omittedFileCount === 0);

console.log("\n-- 250-commit cap is detected, not silently swallowed --");
const mkRes = (n, total) => ({
  ok: true, status: 200,
  json: async () => ({
    ...(total === undefined ? {} : { total_commits: total }),
    commits: Array.from({ length: n }, (_, i) => ({ sha: "s" + i, commit: { message: "m" } })),
    files: []
  })
});

(async () => {
  global.fetch = async () => mkRes(250, 412);
  const cut = await fetchChangeRange({ repo: "a/b", fromRef: "v1", toRef: "v2", githubToken: "t" });
  check("truncation flagged", cut.commitsTruncated === true);
  check("real total reported", cut.totalCommits === 412, cut.totalCommits);
  check("analyzed count is what came back", cut.commits.length === 250);

  global.fetch = async () => mkRes(10, 10);
  const whole = await fetchChangeRange({ repo: "a/b", fromRef: "v1", toRef: "v2", githubToken: "t" });
  check("complete range not flagged", whole.commitsTruncated === false);

  global.fetch = async () => mkRes(1, undefined);
  const noTotal = await fetchChangeRange({ repo: "a/b", fromRef: "v1", toRef: "v2", githubToken: "t" });
  check("missing total_commits -> not truncated", noTotal.commitsTruncated === false);
  check("falls back to commit count", noTotal.totalCommits === 1);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
