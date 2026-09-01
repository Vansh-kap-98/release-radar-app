const { callModel, classifyChanges } = require("../core/ai.js");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

function mkRes({ status, body, headers = {} }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

const OK_ANTHROPIC = { content: [{ text: '[{"sha":"abc","title":"t","category":"fix"}]' }] };
const OK_OPENAI = { choices: [{ message: { content: '[{"sha":"abc","title":"t","category":"fix"}]' } }] };
const OK_GOOGLE = { candidates: [{ content: { parts: [{ text: '[{"sha":"abc","title":"t","category":"fix"}]' }] } }] };

(async () => {
  console.log("-- 429 triggers retry then succeeds --");
  {
    let calls = 0;
    const waits = [];
    global.fetch = async () => {
      calls++;
      if (calls <= 2) return mkRes({ status: 429, body: { error: "rate limited" } });
      return mkRes({ status: 200, body: OK_ANTHROPIC });
    };
    const started = Date.now();
    // Patch sleep indirectly: we can't, so use retry-after: 0 to keep it fast.
    global.fetch = async () => {
      calls++;
      if (calls <= 2) return mkRes({ status: 429, body: {}, headers: { "retry-after": "0" } });
      return mkRes({ status: 200, body: OK_ANTHROPIC });
    };
    calls = 0;
    const text = await callModel({
      provider: "anthropic", apiKey: "k", system: "s", user: "u",
      onRetry: (info) => waits.push(info)
    });
    check("retried until success", calls === 3, `calls=${calls}`);
    check("onRetry fired twice", waits.length === 2, JSON.stringify(waits));
    check("returned parsed text", text.includes("abc"));
    check("honoured retry-after: 0 (fast)", Date.now() - started < 2000);
  }

  console.log("\n-- exhausting retries throws a friendly error --");
  {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      return mkRes({ status: 429, body: {}, headers: { "retry-after": "0" } });
    };
    let msg = null;
    try {
      await callModel({ provider: "groq", apiKey: "k", system: "s", user: "u" });
    } catch (e) { msg = e.message; }
    check("4 total attempts (1 + 3 retries)", calls === 4, `calls=${calls}`);
    check("friendly message names provider", /Rate limit reached on Groq/.test(msg), msg);
    check("suggests switching providers", /switch providers in Settings/.test(msg), msg);
    check("not a raw fetch error", !/fetch failed|undefined/.test(msg), msg);
  }

  console.log("\n-- retry-after HTTP-date form is parsed --");
  {
    let calls = 0;
    const waits = [];
    global.fetch = async () => {
      calls++;
      if (calls === 1) {
        return mkRes({ status: 429, body: {}, headers: { "retry-after": new Date(Date.now() + 1000).toUTCString() } });
      }
      return mkRes({ status: 200, body: OK_OPENAI });
    };
    await callModel({ provider: "openai", apiKey: "k", system: "s", user: "u", onRetry: (i) => waits.push(i) });
    check("date-form retry-after produced a wait", waits.length === 1 && waits[0].waitMs > 0, JSON.stringify(waits));
  }

  console.log("\n-- client errors do NOT retry, server errors DO --");
  {
    let calls = 0;
    global.fetch = async () => { calls++; return mkRes({ status: 400, body: { e: "bad request" } }); };
    let msg = null;
    try { await callModel({ provider: "openai", apiKey: "k", system: "s", user: "u" }); } catch (e) { msg = e.message; }
    check("400 fails immediately", calls === 1, `calls=${calls}`);
    check("400 surfaces the response body", /bad request/.test(msg), msg);

    // Gemini returns 503 when transiently overloaded - worth retrying.
    calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls <= 2) return mkRes({ status: 503, body: { e: "high demand" }, headers: { "retry-after": "0" } });
      return mkRes({ status: 200, body: OK_OPENAI });
    };
    const text = await callModel({ provider: "openai", apiKey: "k", system: "s", user: "u" });
    check("503 retries then succeeds", calls === 3 && text.includes("abc"), `calls=${calls}`);

    calls = 0;
    global.fetch = async () => { calls++; return mkRes({ status: 503, body: {}, headers: { "retry-after": "0" } }); };
    let msg2 = null;
    try { await callModel({ provider: "google", apiKey: "k", system: "s", user: "u" }); } catch (e) { msg2 = e.message; }
    check("exhausted 503 gives an availability message", /temporarily unavailable \(503\)/.test(msg2), msg2);
    check("503 message is not the rate-limit one", !/Rate limit reached/.test(msg2), msg2);
  }

  console.log("\n-- all four providers work identically through retry path --");
  for (const [provider, body] of [["anthropic", OK_ANTHROPIC], ["openai", OK_OPENAI], ["groq", OK_OPENAI], ["google", OK_GOOGLE]]) {
    let calls = 0;
    global.fetch = async () => {
      calls++;
      if (calls === 1) return mkRes({ status: 429, body: {}, headers: { "retry-after": "0" } });
      return mkRes({ status: 200, body });
    };
    const text = await callModel({ provider, apiKey: "k", system: "s", user: "u" });
    check(`${provider}: retried and returned content`, text.includes("abc") && calls === 2, `calls=${calls}`);
  }

  console.log("\n-- toggle OFF sends no diff data --");
  {
    let sentBody = null;
    global.fetch = async (url, opts) => { sentBody = JSON.parse(opts.body); return mkRes({ status: 200, body: OK_ANTHROPIC }); };
    const commits = [{ sha: "abc", message: "fix stuff" }];
    const fileContext = { files: [{ filename: "a.js", patch: "@@\n+secret-diff-marker" }], omittedFileCount: 0, responseCapped: false };
    await classifyChanges(commits, null, { provider: "anthropic", apiKey: "k" });
    const payload = JSON.stringify(sentBody);
    check("no diff marker in prompt", !payload.includes("secret-diff-marker"));
    check("no 'files' key in user payload", !JSON.parse(sentBody.messages[0].content).files);
    check("user payload is the bare commit array", Array.isArray(JSON.parse(sentBody.messages[0].content)));
    check("max_tokens stays at 2000", sentBody.max_tokens === 2000, sentBody.max_tokens);

    console.log("\n-- toggle ON includes diff data --");
    await classifyChanges(commits, fileContext, { provider: "anthropic", apiKey: "k" });
    const payload2 = JSON.stringify(sentBody);
    check("diff marker present", payload2.includes("secret-diff-marker"));
    check("diffCoverage metadata present", payload2.includes("diffCoverage"));
    check("max_tokens raised to 8000", sentBody.max_tokens === 8000, sentBody.max_tokens);
    check("system prompt is the diff-aware one", sentBody.system.includes("file diffs"));
  }

  console.log("\n-- gemini request shape --");
  {
    let sentUrl = null, sentHeaders = null, sentBody = null;
    global.fetch = async (url, opts) => {
      sentUrl = url; sentHeaders = opts.headers; sentBody = JSON.parse(opts.body);
      return mkRes({ status: 200, body: OK_GOOGLE });
    };
    const text = await callModel({ provider: "google", apiKey: "gkey", system: "SYS", user: "USR", maxTokens: 8000 });
    check("returns parsed text", text.includes("abc"));
    check("uses the configured gemini model in the URL", /models\/gemini-3\.6-flash:generateContent$/.test(sentUrl), sentUrl);
    check("key sent as header, not in URL", sentHeaders["x-goog-api-key"] === "gkey" && !sentUrl.includes("gkey"), sentUrl);
    check("system prompt in systemInstruction", sentBody.systemInstruction.parts[0].text === "SYS");
    check("user prompt in contents parts", sentBody.contents[0].parts[0].text === "USR");
    check("maxOutputTokens honoured", sentBody.generationConfig.maxOutputTokens === 8000, sentBody.generationConfig.maxOutputTokens);
    check("thinking minimised so JSON is not truncated", sentBody.generationConfig.thinkingConfig.thinkingLevel === "minimal", JSON.stringify(sentBody.generationConfig.thinkingConfig));
  }

  console.log("\n-- gemini blocked/empty response --");
  {
    global.fetch = async () => mkRes({ status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } });
    let msg = null;
    try { await callModel({ provider: "google", apiKey: "k", system: "s", user: "u" }); } catch (e) { msg = e.message; }
    check("blocked response gives a clear error", /blocked: SAFETY/.test(msg), msg);
    check("not a TypeError on undefined", !/Cannot read/.test(msg), msg);

    global.fetch = async () => mkRes({ status: 200, body: {} });
    let msg2 = null;
    try { await callModel({ provider: "google", apiKey: "k", system: "s", user: "u" }); } catch (e) { msg2 = e.message; }
    check("empty response gives a clear error", /returned no content/.test(msg2), msg2);
  }

  console.log("\n-- unknown provider still rejected --");
  {
    let msg = null;
    try { await callModel({ provider: "nope", apiKey: "k", system: "s", user: "u" }); } catch (e) { msg = e.message; }
    check("unknown provider throws", /Unknown AI provider: nope/.test(msg), msg);
  }


  console.log("\n-- multiple entries per commit survive the sha guardrail --");
  {
    // One squashed commit can contain several distinct changes; the pipeline
    // must not collapse or drop them.
    const many = JSON.stringify([
      { sha: "c1", title: "commit picker", category: "feat" },
      { sha: "c1", title: "auto-detect latest tag", category: "feat" },
      { sha: "c1", title: "semver suggestion", category: "feat" },
      { sha: "c2", title: "changelog history", category: "feat" },
      { sha: "ghost", title: "hallucinated", category: "feat" }
    ]);
    global.fetch = async () => mkRes({ status: 200, body: { content: [{ text: many }] } });
    const { changes: out, versionBump } = await classifyChanges(
      [{ sha: "c1", message: "features 1 2 3 added" }, { sha: "c2", message: "wip" }],
      { files: [], omittedFileCount: 0, responseCapped: false },
      { provider: "anthropic", apiKey: "k" }
    );
    check("keeps all 3 entries from one commit", out.filter((c) => c.sha === "c1").length === 3, out.length);
    check("keeps entry from the second commit", out.some((c) => c.sha === "c2"));
    check("still drops the hallucinated sha", !out.some((c) => c.sha === "ghost"));
    check("total is 4, not collapsed to 2", out.length === 4, out.length);
    check("no version bump when model returned a bare array", versionBump === null, JSON.stringify(versionBump));
  }

  console.log("\n-- detailed prompt permits multi-entry output --");
  {
    let sent = null;
    global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return mkRes({ status: 200, body: OK_ANTHROPIC }); };
    await classifyChanges(
      [{ sha: "abc", message: "m" }],
      { files: [{ filename: "a.js", patch: "@@\n+x" }], omittedFileCount: 0, responseCapped: false },
      { provider: "anthropic", apiKey: "k" }
    );
    check("no longer demands one entry per commit", !/exactly one object per commit/.test(sent.system));
    check("explicitly allows splitting a commit", /separate entry for each/i.test(sent.system));
    check("asks for concrete, user-facing titles", /Be concrete/.test(sent.system));
  }


  console.log("\n-- AI version decision is parsed from the same call --");
  {
    const body = JSON.stringify({
      changes: [{ sha: "c1", title: "big thing", category: "feat" }],
      version: { bump: "major", reasoning: "Introduces an entirely new subsystem." }
    });
    global.fetch = async () => mkRes({ status: 200, body: { content: [{ text: body }] } });
    const out = await classifyChanges([{ sha: "c1", message: "m" }], null, { provider: "anthropic", apiKey: "k" });
    check("changes extracted from the wrapper object", out.changes.length === 1, out.changes.length);
    check("versionBump extracted", out.versionBump && out.versionBump.bump === "major", JSON.stringify(out.versionBump));
    check("versionBump reasoning kept", /new subsystem/.test(out.versionBump.reasoning));

    // A model that answers with an invalid bump must not poison the result.
    global.fetch = async () => mkRes({ status: 200, body: { content: [{ text: JSON.stringify({ changes: [], version: { bump: "enormous" } }) }] } });
    const bad = await classifyChanges([{ sha: "c1", message: "m" }], null, { provider: "anthropic", apiKey: "k" });
    check("invalid bump rejected -> null", bad.versionBump === null, JSON.stringify(bad.versionBump));

    // No version key at all is fine.
    global.fetch = async () => mkRes({ status: 200, body: { content: [{ text: JSON.stringify({ changes: [] }) }] } });
    const none = await classifyChanges([{ sha: "c1", message: "m" }], null, { provider: "anthropic", apiKey: "k" });
    check("missing version key -> null", none.versionBump === null);
  }

  console.log("\n-- both prompts ask for a version decision --");
  {
    let sent = null;
    global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return mkRes({ status: 200, body: OK_ANTHROPIC }); };
    await classifyChanges([{ sha: "abc", message: "m" }], null, { provider: "anthropic", apiKey: "k" });
    check("basic prompt requests a bump", /VERSION RECOMMENDATION/.test(sent.system));
    check("basic prompt defines major as breaking OR major feature", /MAJOR feature addition/.test(sent.system));
    await classifyChanges([{ sha: "abc", message: "m" }], { files: [], omittedFileCount: 0, responseCapped: false }, { provider: "anthropic", apiKey: "k" });
    check("diff-aware prompt requests a bump", /VERSION RECOMMENDATION/.test(sent.system));
  }


  console.log("\n-- diffMeta reports exactly what was sent --");
  {
    const fileContext = {
      files: [
        { filename: "src/a.js", patch: "@@\n+aaaa" },          // 9 chars
        { filename: "src/b.js", patch: "@@\n+bb" },            // 7 chars
        { filename: "package-lock.json", patch: null, generated: true },
        { filename: "logo.png", patch: null }
      ],
      omittedFileCount: 5,
      responseCapped: false
    };
    global.fetch = async () => mkRes({ status: 200, body: OK_ANTHROPIC });

    const off = await classifyChanges([{ sha: "abc", message: "m" }], null, { provider: "anthropic", apiKey: "k" });
    check("detailed OFF -> diffMeta is null", off.diffMeta === null, JSON.stringify(off.diffMeta));

    const on = await classifyChanges([{ sha: "abc", message: "m" }], fileContext, { provider: "anthropic", apiKey: "k" });
    check("filesIncluded counts what was sent", on.diffMeta.filesIncluded === 4, on.diffMeta.filesIncluded);
    check("filesOmitted passed through", on.diffMeta.filesOmitted === 5, on.diffMeta.filesOmitted);
    check("filesWithoutPatch counted", on.diffMeta.filesWithoutPatch === 2, on.diffMeta.filesWithoutPatch);
    const expectedChars = fileContext.files.reduce((n, f) => n + (f.patch ? f.patch.length : 0), 0);
    check("totalDiffChars sums only real patches", on.diffMeta.totalDiffChars === expectedChars, `${on.diffMeta.totalDiffChars} vs ${expectedChars}`);
    check("patchless files contribute 0 chars", expectedChars > 0 && on.diffMeta.totalDiffChars < 40, on.diffMeta.totalDiffChars);
  }

  console.log("\n-- detailed OFF is byte-for-byte the old behaviour --");
  {
    let sent = null;
    global.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return mkRes({ status: 200, body: OK_ANTHROPIC }); };
    const commits = [{ sha: "abc", message: "fix stuff" }];
    await classifyChanges(commits, null, { provider: "anthropic", apiKey: "k" });
    const payload = JSON.parse(sent.messages[0].content);
    check("payload is the bare commit array", Array.isArray(payload) && payload.length === 1);
    check("no files key anywhere in the request", !JSON.stringify(sent).includes("\"files\""));
    check("max_tokens unchanged at 2000", sent.max_tokens === 2000, sent.max_tokens);
    check("uses the non-diff prompt", !/file diffs/.test(sent.system));
  }


  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
