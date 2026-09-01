// Covers the "Generate a GitHub token for Release Radar" deep link.
//
// The URL is the whole feature, so it is asserted exactly rather than loosely:
// a typo'd scope or a dropped query param produces a token that silently can't
// do what the app needs, and the user only finds out at publish time.
//
// Loads electron/main.js with electron and the settings store stubbed, the
// same way test-cache.js does, so the real IPC handler is exercised.

const Module = require("module");
const path = require("path");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

const handlers = {};
const opened = [];
let apiBaseUrl = ""; // mutable so the GHES case can be exercised

const origLoad = Module._load;
Module._load = function (request) {
  if (request === "electron") {
    return {
      app: { whenReady: () => ({ then: () => {} }), on: () => {}, quit: () => {} },
      BrowserWindow: Object.assign(
        function () { return { loadURL() {}, loadFile() {}, webContents: { openDevTools() {} } }; },
        { getAllWindows: () => [1], fromWebContents: () => null },
      ),
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
      shell: { openExternal: async (url) => { opened.push(url); return true; } },
    };
  }
  // main.js pulls in lib/history.js, which constructs an electron-store at
  // module load. Stub the module rather than the handful of Electron app
  // methods it happens to call today.
  if (request === "electron-store") {
    return class FakeStore {
      constructor() { this.data = {}; }
      get(k) { return this.data[k]; }
      set(k, v) { this.data[k] = v; }
      delete(k) { delete this.data[k]; }
    };
  }
  if (request.includes("lib/store")) {
    return {
      getSecret: (k) => (k === "githubApiBaseUrl" ? apiBaseUrl : null),
      setSecret: () => {},
      getAll: () => ({}),
    };
  }
  return origLoad.apply(this, arguments);
};

require(path.join(__dirname, "..", "electron", "main.js"));
Module._load = origLoad;

const CHANNEL = "settings:open-token-creation-url";
const EXPECTED = "https://github.com/settings/tokens/new?description=Release+Radar&scopes=repo";

(async () => {
  console.log("-- handler registration --");
  {
    check("main.js registers the channel", typeof handlers[CHANNEL] === "function", Object.keys(handlers));
  }

  console.log("-- default URL is exactly the documented one --");
  {
    opened.length = 0;
    apiBaseUrl = "";
    const result = await handlers[CHANNEL]({});
    check("opened exactly one URL", opened.length === 1, opened);
    check("URL matches the spec byte for byte", opened[0] === EXPECTED, opened[0]);
    check("handler reports what it opened", result && result.opened === true && result.url === EXPECTED, result);
  }

  console.log("-- query parameters --");
  {
    const u = new URL(opened[0]);
    check("host is github.com", u.host === "github.com", u.host);
    check("scheme is https", u.protocol === "https:", u.protocol);
    // Classic, not fine-grained: a fine-grained token's repository selection is
    // a manual picker with no URL equivalent, so it could not express "all
    // repositories" and would add a step rather than remove one.
    check("uses the classic token path", u.pathname === "/settings/tokens/new", u.pathname);
    check("not the fine-grained path", !u.pathname.includes("personal-access-tokens"), u.pathname);
    check("description decodes to 'Release Radar'", u.searchParams.get("description") === "Release Radar", u.searchParams.get("description"));
    check("scopes decodes to 'repo'", u.searchParams.get("scopes") === "repo", u.searchParams.get("scopes"));
    check("space is encoded as +", opened[0].includes("description=Release+Radar"), opened[0]);
    check("space is NOT encoded as %20", !opened[0].includes("%20"), opened[0]);
    check("exactly two query params", [...u.searchParams.keys()].length === 2, [...u.searchParams.keys()]);
  }

  console.log("-- no expiration parameter --");
  {
    // Classic tokens set expiry from a dropdown on the page; anything passed in
    // the URL is silently ignored, so sending one would be cargo cult.
    check("no expires_in", !/expires_in/i.test(opened[0]), opened[0]);
    check("no expiration/expiry of any spelling", !/expir/i.test(opened[0]), opened[0]);
  }

  console.log("-- single scope covers the whole app --");
  {
    const scopes = new URL(opened[0]).searchParams.get("scopes").split(",");
    check("exactly one scope requested", scopes.length === 1, scopes);
    check("that scope is repo", scopes[0] === "repo", scopes);
    // repo already implies these; asking for them separately would widen the
    // consent screen for no gain.
    check("does not enumerate sub-scopes", !/repo:status|public_repo|repo_deployment/.test(opened[0]), opened[0]);
  }

  console.log("-- GitHub Enterprise Server --");
  {
    opened.length = 0;
    apiBaseUrl = "https://ghe.example.com/api/v3";
    await handlers[CHANNEL]({});
    check(
      "sends the user to their appliance, not github.com",
      opened[0] === "https://ghe.example.com/settings/tokens/new?description=Release+Radar&scopes=repo",
      opened[0],
    );
    check("query string is unchanged", opened[0].endsWith("?description=Release+Radar&scopes=repo"), opened[0]);
  }

  console.log("-- refuses a non-web scheme --");
  {
    opened.length = 0;
    // The host comes from a user-editable setting, and shell.openExternal will
    // hand any scheme to the OS. Validation in the UI is not a guarantee here.
    apiBaseUrl = "file:///etc/passwd";
    let threw = false;
    try { await handlers[CHANNEL]({}); } catch { threw = true; }
    check("throws rather than opening", threw);
    check("nothing was opened", opened.length === 0, opened);
    apiBaseUrl = "";
  }

  console.log("-- preload exposes it on the same channel --");
  {
    const fs = require("fs");
    const src = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.js"), "utf8");
    check("preload exposes openTokenCreationUrl", /openTokenCreationUrl:/.test(src));
    check("preload invokes the same channel name", src.includes(`invoke("${CHANNEL}")`), CHANNEL);
    check("preload passes no arguments", /openTokenCreationUrl:\s*\(\)\s*=>/.test(src));
  }

  console.log("-- the manual paste field is still there --");
  {
    const fs = require("fs");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "components", "rr", "SettingsTab.jsx"),
      "utf8",
    );
    check("token input still rendered", /id="gh"/.test(src));
    check("token input still writes state", /onChange=\{\(e\) => setGithubToken\(e\.target\.value\)\}/.test(src));
    check("save still persists the pasted token", /setSetting\("githubToken", githubToken\)/.test(src));
    check("button is wired to the api helper", /openTokenCreationUrl\(\)/.test(src));
    check("helper text sets the copy-paste expectation", /paste the token below/.test(src));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
