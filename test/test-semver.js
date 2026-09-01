const { parseVersion, suggestBump, nextVersion } = require("../core/semver.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

console.log("-- parseVersion --");
check("v-prefixed", JSON.stringify(parseVersion("v1.4.2")) === JSON.stringify({ major: 1, minor: 4, patch: 2 }));
check("no prefix", JSON.stringify(parseVersion("2.0.10")) === JSON.stringify({ major: 2, minor: 0, patch: 10 }));
check("whitespace tolerated", parseVersion("  v1.2.3  ").minor === 2);
check("prerelease suffix rejected", parseVersion("v1.2.3-beta.1") === null);
check("two-part rejected", parseVersion("1.2") === null);
check("garbage rejected", parseVersion("release-42") === null);
check("raw sha rejected", parseVersion("cf5e06dc2dfe0f1e186f3ca9fa0991efb1aee17d") === null);
check("empty -> null", parseVersion("") === null);
check("null -> null (no throw)", parseVersion(null) === null);
check("number -> null (no throw)", parseVersion(123) === null);

console.log("\n-- suggestBump --");
check("breaking wins over feat", suggestBump([{ category: "feat" }, { category: "breaking" }]) === "major");
check("feat -> minor", suggestBump([{ category: "fix" }, { category: "feat" }]) === "minor");
check("fix/docs/chore -> patch", suggestBump([{ category: "fix" }, { category: "docs" }, { category: "chore" }]) === "patch");
check("empty -> patch (safe default)", suggestBump([]) === "patch");
check("null -> patch (no throw)", suggestBump(null) === "patch");
check("junk entries tolerated", suggestBump([null, undefined, {}]) === "patch");

console.log("\n-- nextVersion: standard bumps --");
const major = nextVersion("v1.4.2", [{ category: "breaking" }]);
check("1.x breaking -> major", major.suggested === "v2.0.0", major.suggested);
check("major resets minor and patch", major.suggested === "v2.0.0");
check("bump reported", major.bump === "major");
check("reasoning mentions breaking", /breaking change/.test(major.reasoning), major.reasoning);

const minor = nextVersion("v1.4.2", [{ category: "feat" }, { category: "feat" }, { category: "fix" }]);
check("feat -> minor", minor.suggested === "v1.5.0", minor.suggested);
check("minor resets patch", minor.suggested.endsWith(".0"));
check("reasoning counts features", /2 new features/.test(minor.reasoning), minor.reasoning);

const patch = nextVersion("v1.4.2", [{ category: "fix" }, { category: "docs" }]);
check("fix/docs -> patch", patch.suggested === "v1.4.3", patch.suggested);
check("reasoning says patch only", /patch bump only/.test(patch.reasoning), patch.reasoning);

console.log("\n-- nextVersion: 0ver rule --");
const zero = nextVersion("0.4.2", [{ category: "breaking" }]);
check("0.x breaking -> MINOR not major", zero.suggested === "0.5.0", zero.suggested);
check("0.x breaking reports minor bump", zero.bump === "minor", zero.bump);
check("0ver reasoning explains itself", /0\.x release/.test(zero.reasoning), zero.reasoning);
check("0.x feat still minor", nextVersion("0.4.2", [{ category: "feat" }]).suggested === "0.5.0");
check("0.x fix still patch", nextVersion("0.4.2", [{ category: "fix" }]).suggested === "0.4.3");
check("1.0.0 is NOT treated as 0ver", nextVersion("1.0.0", [{ category: "breaking" }]).suggested === "2.0.0");

console.log("\n-- nextVersion: prefix + malformed input --");
check("v prefix preserved", nextVersion("v1.0.0", [{ category: "fix" }]).suggested === "v1.0.1");
check("bare prefix preserved", nextVersion("1.0.0", [{ category: "fix" }]).suggested === "1.0.1");
const bad = nextVersion("cf5e06dc2dfe", [{ category: "feat" }]);
check("unparseable -> null suggestion", bad.suggested === null && bad.bump === null);
check("unparseable echoes input", bad.current === "cf5e06dc2dfe");
check("unparseable reasoning is explanatory", /Could not parse a version from 'cf5e06dc2dfe'/.test(bad.reasoning), bad.reasoning);
check("unparseable does not throw", true);
check("null input handled", nextVersion(null, []).suggested === null);
check("empty changes still bumps patch", nextVersion("v1.0.0", []).suggested === "v1.0.1");
check("empty changes reasoning", /No classified changes/.test(nextVersion("v1.0.0", []).reasoning));

console.log("\n-- nextVersion: AI decides the bump --");
const aiMajor = nextVersion("v1.4.2", [{ category: "feat" }], { bump: "major", reasoning: "Adds a whole new export subsystem." });
check("AI major on feature-only changes", aiMajor.suggested === "v2.0.0", aiMajor.suggested);
check("AI bump reported", aiMajor.bump === "major");
check("flagged decidedBy ai", aiMajor.decidedBy === "ai");
check("AI reasoning surfaced", /export subsystem/.test(aiMajor.reasoning), aiMajor.reasoning);
check("AI reasoning labels itself", /AI-recommended/.test(aiMajor.reasoning), aiMajor.reasoning);

const aiPatch = nextVersion("v1.4.2", [{ category: "breaking" }], { bump: "patch", reasoning: "Internal rename only." });
check("AI can downgrade below the category rule", aiPatch.suggested === "v1.4.3", aiPatch.suggested);

const aiZero = nextVersion("0.4.2", [{ category: "feat" }], { bump: "major", reasoning: "Major new capability." });
check("AI major on 0.x is NOT downgraded", aiZero.suggested === "1.0.0", aiZero.suggested);

const ruleZero = nextVersion("0.4.2", [{ category: "breaking" }]);
check("fallback still applies the 0.x guard", ruleZero.suggested === "0.5.0", ruleZero.suggested);
check("fallback flagged decidedBy rules", ruleZero.decidedBy === "rules");

check("invalid AI bump falls back to rules", nextVersion("v1.4.2", [{ category: "feat" }], { bump: "huge" }).suggested === "v1.5.0");
check("null AI bump falls back to rules", nextVersion("v1.4.2", [{ category: "feat" }], null).decidedBy === "rules");
check("AI bump ignored when version unparseable", nextVersion("abc", [], { bump: "major" }).suggested === null);


console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
