// Covers electron/lib/store.js after preferences (demoMode, theme,
// githubApiBaseUrl) were added alongside the encrypted secrets.
//
// The properties that matter:
//  - secrets are still encrypted and still never returned to the renderer;
//  - preferences are readable, because the UI needs their real values;
//  - defaults reproduce the behavior that existed before these keys existed;
//  - records written by an OLDER build still load.
//
// electron isn't available outside Electron, so both `electron` and
// `electron-store` are stubbed in the module cache before store.js is loaded.

const path = require("path");
const Module = require("module");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

// --- stubs ---------------------------------------------------------------

let backing = {};
let encryptionAvailable = true;

class FakeStore {
  get(key) { return backing[key]; }
  set(key, value) { backing[key] = value; }
  delete(key) { delete backing[key]; }
}

const electronStub = {
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    // Reversible stand-in for the OS keychain: enough to prove the value is
    // transformed on the way in and restored on the way out.
    encryptString: (s) => Buffer.from(`enc:${s}`, "utf8"),
    decryptString: (buf) => {
      const text = buf.toString("utf8");
      if (!text.startsWith("enc:")) throw new Error("not encrypted by this stub");
      return text.slice(4);
    }
  }
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (request === "electron-store") return FakeStore;
  return originalLoad.call(this, request, parent, isMain);
};

const storePath = path.join(__dirname, "..", "electron", "lib", "store.js");
function loadStore() {
  delete require.cache[require.resolve(storePath)];
  return require(storePath);
}

// --- tests ---------------------------------------------------------------

console.log("-- defaults reproduce pre-existing behavior --");
{
  backing = {};
  const { getSecret, getAll } = loadStore();

  check("aiProvider defaults to anthropic", getSecret("aiProvider") === "anthropic", getSecret("aiProvider"));
  check("theme defaults to system", getSecret("theme") === "system", getSecret("theme"));
  check("demoMode defaults to off", getSecret("demoMode") === "", JSON.stringify(getSecret("demoMode")));
  check("api base url defaults to blank", getSecret("githubApiBaseUrl") === "", JSON.stringify(getSecret("githubApiBaseUrl")));

  const all = getAll();
  check("getAll reports demo mode off", all.demoMode === false, all.demoMode);
  check("getAll reports theme system", all.theme === "system", all.theme);
  check("getAll reports blank base url", all.githubApiBaseUrl === "", JSON.stringify(all.githubApiBaseUrl));
  check("getAll reports no github token", all.githubToken === false);
  check("getAll reports no ai key", all.aiApiKey === false);
  check("getAll reports no slack webhook", all.slackWebhookUrl === false);
  check("getAll still exposes aiProviderValue", all.aiProviderValue === "anthropic", all.aiProviderValue);
}

console.log("-- secrets are encrypted at rest and never returned raw --");
{
  backing = {};
  encryptionAvailable = true;
  const { setSecret, getSecret, getAll } = loadStore();

  setSecret("githubToken", "ghp_supersecret");
  check("stored record is marked encrypted", backing.githubToken.encrypted === true, backing.githubToken);
  check("plaintext is not on disk", !JSON.stringify(backing.githubToken).includes("ghp_supersecret"), backing.githubToken);
  check("round-trips back to the original", getSecret("githubToken") === "ghp_supersecret", getSecret("githubToken"));

  setSecret("aiApiKey", "sk-abc");
  setSecret("slackWebhookUrl", "https://hooks.slack.com/x");
  check("ai key is encrypted", backing.aiApiKey.encrypted === true);
  check("slack webhook is encrypted", backing.slackWebhookUrl.encrypted === true);

  const all = getAll();
  check("getAll returns a boolean for githubToken", all.githubToken === true);
  check("getAll returns a boolean for aiApiKey", all.aiApiKey === true);
  check("getAll returns a boolean for slackWebhookUrl", all.slackWebhookUrl === true);
  check(
    "no secret value appears anywhere in getAll()",
    !JSON.stringify(all).includes("ghp_supersecret") &&
      !JSON.stringify(all).includes("sk-abc") &&
      !JSON.stringify(all).includes("hooks.slack.com"),
    all
  );
}

console.log("-- preferences are stored unencrypted and read back --");
{
  backing = {};
  const { setSecret, getSecret, getAll } = loadStore();

  setSecret("theme", "dark");
  setSecret("githubApiBaseUrl", "https://ghe.example.com/api/v3");
  setSecret("demoMode", "true");

  check("theme record is not encrypted", backing.theme.encrypted === false, backing.theme);
  check("base url record is not encrypted", backing.githubApiBaseUrl.encrypted === false);
  check("theme reads back", getSecret("theme") === "dark", getSecret("theme"));
  check("base url reads back", getSecret("githubApiBaseUrl") === "https://ghe.example.com/api/v3");

  const all = getAll();
  check("getAll exposes the real theme", all.theme === "dark", all.theme);
  check("getAll exposes the real base url", all.githubApiBaseUrl === "https://ghe.example.com/api/v3", all.githubApiBaseUrl);
  check("getAll reports demo mode on", all.demoMode === true, all.demoMode);
}

console.log("-- a falsy value clears a key back to its default --");
{
  backing = {};
  const { setSecret, getSecret, getAll } = loadStore();

  setSecret("demoMode", "true");
  check("demo mode is on", getAll().demoMode === true);
  setSecret("demoMode", "");
  check("blank removes the record", backing.demoMode === undefined, backing.demoMode);
  check("demo mode falls back to off", getAll().demoMode === false);

  setSecret("theme", "dark");
  setSecret("theme", "");
  check("cleared theme falls back to system", getSecret("theme") === "system", getSecret("theme"));

  setSecret("githubToken", "x");
  setSecret("githubToken", "");
  check("cleared secret is gone", backing.githubToken === undefined);
  check("cleared secret reads back as null", getSecret("githubToken") === null, getSecret("githubToken"));
}

console.log("-- unknown keys are rejected --");
{
  backing = {};
  const { setSecret } = loadStore();
  let threw = false;
  try { setSecret("somethingElse", "x"); } catch { threw = true; }
  check("an unknown setting key throws", threw);
  check("nothing was written", Object.keys(backing).length === 0, backing);
}

console.log("-- records written by an older build still load --");
{
  // Before preferences existed, aiProvider was written through the encrypted
  // path. Those records must keep working after the split.
  backing = {
    aiProvider: { encrypted: true, data: Buffer.from("enc:groq", "utf8").toString("base64") }
  };
  const { getSecret, getAll } = loadStore();
  check("legacy encrypted aiProvider decrypts", getSecret("aiProvider") === "groq", getSecret("aiProvider"));
  check("getAll surfaces it", getAll().aiProviderValue === "groq", getAll().aiProviderValue);
  check("missing new keys still default", getAll().theme === "system" && getAll().demoMode === false);
}

console.log("-- unencrypted fallback when the OS offers no keychain --");
{
  backing = {};
  encryptionAvailable = false;
  const { setSecret, getSecret } = loadStore();
  setSecret("githubToken", "plain-token");
  check("record is marked unencrypted", backing.githubToken.encrypted === false, backing.githubToken);
  check("value still round-trips", getSecret("githubToken") === "plain-token");
  encryptionAvailable = true;
}

console.log("-- key lists are coherent --");
{
  backing = {};
  const { SECRET_KEYS, PLAIN_KEYS, SETTING_KEYS } = loadStore();
  check("secrets are the three sensitive ones", SECRET_KEYS.join(",") === "githubToken,aiApiKey,slackWebhookUrl", SECRET_KEYS);
  check("preferences include the new keys", ["demoMode", "theme", "githubApiBaseUrl"].every((k) => PLAIN_KEYS.includes(k)), PLAIN_KEYS);
  check("no key is in both lists", !SECRET_KEYS.some((k) => PLAIN_KEYS.includes(k)));
  check("SETTING_KEYS is the union", SETTING_KEYS.length === SECRET_KEYS.length + PLAIN_KEYS.length);
}

Module._load = originalLoad;

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
