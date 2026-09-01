// Runs every test-*.js in this directory and reports a combined tally.
// No test framework — these are plain Node scripts so `npm test` works with
// zero dependencies, matching core/'s dependency-free constraint.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const files = fs.readdirSync(__dirname).filter((f) => /^test-.*\.js$/.test(f)).sort();
let totalPass = 0, totalFail = 0, suitesFailed = 0;

for (const file of files) {
  let out = "";
  let crashed = false;
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, file)], { encoding: "utf8" });
  } catch (e) {
    out = `${e.stdout || ""}${e.stderr || ""}`;
    crashed = true;
  }
  const m = /(\d+) passed, (\d+) failed/.exec(out.replace(/\r/g, ""));
  const p = m ? Number(m[1]) : 0;
  const f = m ? Number(m[2]) : 0;
  totalPass += p; totalFail += f;
  if (crashed || f > 0 || !m) {
    suitesFailed++;
    console.log(`  FAIL  ${file.padEnd(20)} ${m ? `${p} passed, ${f} failed` : "did not report a tally"}`);
    console.log(out.split("\n").filter((l) => /FAIL|Error|error/.test(l)).slice(0, 8).map((l) => "        " + l).join("\n"));
  } else {
    console.log(`  ok    ${file.padEnd(20)} ${p} passed`);
  }
}

console.log(`\n${totalPass} passed, ${totalFail} failed across ${files.length} suites`);
process.exit(suitesFailed ? 1 : 0);
