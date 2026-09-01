const { markdownToHtml, markdownToPlainText } = require("../core/export.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

const SAMPLE = [
  "## acme/widgets — v1.0.0...v1.1.0",
  "",
  "### Breaking Changes",
  "- dropped the legacy config format",
  "",
  "### Features",
  "- **picker**: select a range by clicking two rows",
  "- now uses `fetch` internally",
  "- see [the docs](https://example.com/docs)",
  ""
].join("\n");

console.log("-- markdownToHtml --");
const html = markdownToHtml(SAMPLE);
check("h2 rendered", /<h2>acme\/widgets — v1\.0\.0\.\.\.v1\.1\.0<\/h2>/.test(html), html.slice(0, 80));
check("h3 rendered", /<h3>Features<\/h3>/.test(html));
check("list wrapped in ul", /<ul>[\s\S]*<\/ul>/.test(html));
check("list items rendered", (html.match(/<li>/g) || []).length === 4, (html.match(/<li>/g) || []).length);
check("bold -> strong", /<strong>picker<\/strong>/.test(html));
check("backticks -> code", /<code>fetch<\/code>/.test(html));
check("link -> anchor", /<a href="https:\/\/example\.com\/docs">the docs<\/a>/.test(html));
check("separate sections make separate lists", (html.match(/<ul>/g) || []).length === 2, (html.match(/<ul>/g) || []).length);
check("no stray markdown left", !/(^|\n)- |\*\*|##/.test(html), html);

console.log("\n-- markdownToHtml: escaping (untrusted commit text) --");
const nasty = markdownToHtml('- fixed <script>alert("xss")</script> & <img onerror=x>');
check("angle brackets escaped", !/<script>/.test(nasty) && /&lt;script&gt;/.test(nasty), nasty);
check("ampersand escaped", /&amp;/.test(nasty), nasty);
check("quotes escaped", /&quot;/.test(nasty), nasty);
check("no raw img tag", !/<img/.test(nasty), nasty);
const linkish = markdownToHtml('- [click](javascript:alert(1))');
check("non-http link not turned into an anchor", !/<a href="javascript/.test(linkish), linkish);

console.log("\n-- markdownToHtml: full document --");
const doc = markdownToHtml(SAMPLE, { fullDocument: true, title: "Release notes v1.1.0" });
check("has doctype", doc.startsWith("<!doctype html>"));
check("title used", /<title>Release notes v1\.1\.0<\/title>/.test(doc));
check("styles inlined (no CDN)", /<style>/.test(doc) && !/https?:\/\/(?!example)/.test(doc.split("<body>")[0]));
check("body content present", /<h3>Features<\/h3>/.test(doc));
check("fragment mode has no doctype", !markdownToHtml(SAMPLE).includes("<!doctype"));

console.log("\n-- markdownToPlainText --");
const text = markdownToPlainText(SAMPLE);
check("no markdown heading markers", !/#/.test(text), text);
check("no bold markers", !/\*\*/.test(text), text);
check("no backticks", !/`/.test(text), text);
check("h2 shouted for hierarchy", /ACME\/WIDGETS/.test(text), text);
check("h3 left as plain line", /\nFeatures\n/.test(text), JSON.stringify(text));
check("bullets kept readable", /- dropped the legacy config format/.test(text));
check("scope prefix flattened", /- picker: select a range/.test(text), text);
check("link becomes text plus url", /- see the docs \(https:\/\/example\.com\/docs\)/.test(text), text);
check("ends with a single newline", text.endsWith("\n") && !text.endsWith("\n\n"));
check("no triple blank lines", !/\n\n\n/.test(text));

console.log("\n-- edge cases --");
check("empty markdown -> empty html", markdownToHtml("") === "");
check("empty markdown -> newline only text", markdownToPlainText("") === "\n");
check("null tolerated (html)", typeof markdownToHtml(null) === "string");
check("null tolerated (text)", typeof markdownToPlainText(null) === "string");
check("plain paragraph becomes <p>", /<p>just a line<\/p>/.test(markdownToHtml("just a line")));
check("asterisk bullets work too", /<li>alt<\/li>/.test(markdownToHtml("* alt")));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
