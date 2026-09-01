// Covers the custom window chrome: the frameless BrowserWindow config and the
// IPC that stands in for the frame that was removed.
//
// Worth testing because the failure modes are silent and platform-specific —
// a macOS build that gets `frame: false` loses its traffic lights entirely,
// and a maximize handler that forgets to report state leaves the title bar
// showing the wrong icon with no error anywhere.
//
// Loads electron/main.js with electron stubbed, the same way test-cache.js and
// test-tokenlink.js do.

const Module = require("module");
const path = require("path");
const fs = require("fs");

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}`, extra ?? ""); fail++; }
}

// --- fake window ----------------------------------------------------------

function makeWindow() {
  return {
    maximized: false,
    destroyed: false,
    calls: [],
    sent: [],
    events: {},
    minimize() { this.calls.push("minimize"); },
    maximize() { this.calls.push("maximize"); this.maximized = true; this.emit("maximize"); },
    unmaximize() { this.calls.push("unmaximize"); this.maximized = false; this.emit("unmaximize"); },
    close() { this.calls.push("close"); },
    isMaximized() { return this.maximized; },
    isDestroyed() { return this.destroyed; },
    on(name, fn) { (this.events[name] ||= []).push(fn); },
    emit(name) { (this.events[name] || []).forEach((fn) => fn()); },
    loadURL() {}, loadFile() {},
    webContents: {
      openDevTools() {},
      isDestroyed: () => false,
      send: null, // wired below, needs the outer `this`
    },
  };
}

const constructed = [];
let currentWindow = null;

const origLoad = Module._load;
const handlers = {};

Module._load = function (request) {
  if (request === "electron") {
    return {
      app: { whenReady: () => ({ then: () => {} }), on: () => {}, quit: () => {} },
      BrowserWindow: Object.assign(
        function (options) {
          constructed.push(options);
          const win = makeWindow();
          win.webContents.send = (channel, payload) => win.sent.push({ channel, payload });
          currentWindow = win;
          return win;
        },
        { getAllWindows: () => [1], fromWebContents: () => currentWindow },
      ),
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      shell: { openExternal: async () => true },
      ipcMain: { handle: (name, fn) => { handlers[name] = fn; } },
    };
  }
  if (request === "electron-store") {
    return class FakeStore {
      constructor() { this.data = {}; }
      get(k) { return this.data[k]; }
      set(k, v) { this.data[k] = v; }
      delete(k) { delete this.data[k]; }
    };
  }
  if (request.includes("lib/store")) {
    return { getSecret: () => null, setSecret: () => {}, getAll: () => ({}) };
  }
  return origLoad.apply(this, arguments);
};

const mainPath = path.join(__dirname, "..", "electron", "main.js");
require(mainPath);
Module._load = origLoad;

const mainSrc = fs.readFileSync(mainPath, "utf8");
const preloadSrc = fs.readFileSync(path.join(__dirname, "..", "electron", "preload.js"), "utf8");
const titleBarSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "components", "rr", "TitleBar.jsx"),
  "utf8",
);

(async () => {
  console.log("-- IPC channels exist --");
  {
    for (const channel of [
      "window:minimize",
      "window:toggle-maximize",
      "window:close",
      "window:is-maximized",
    ]) {
      check(`registers ${channel}`, typeof handlers[channel] === "function", Object.keys(handlers));
    }
  }

  console.log("-- minimize / close --");
  {
    currentWindow = makeWindow();
    await handlers["window:minimize"]({});
    check("minimize calls win.minimize()", currentWindow.calls.includes("minimize"), currentWindow.calls);

    currentWindow = makeWindow();
    await handlers["window:close"]({});
    check("close calls win.close()", currentWindow.calls.includes("close"), currentWindow.calls);
  }

  console.log("-- toggle maximize --");
  {
    currentWindow = makeWindow();
    const first = await handlers["window:toggle-maximize"]({});
    check("maximizes when restored", currentWindow.calls.includes("maximize"), currentWindow.calls);
    check("reports the resulting state (true)", first === true, first);

    const second = await handlers["window:toggle-maximize"]({});
    check("unmaximizes when maximized", currentWindow.calls.includes("unmaximize"), currentWindow.calls);
    check("reports the resulting state (false)", second === false, second);
  }

  console.log("-- is-maximized --");
  {
    currentWindow = makeWindow();
    check("false when restored", (await handlers["window:is-maximized"]({})) === false);
    currentWindow.maximized = true;
    check("true when maximized", (await handlers["window:is-maximized"]({})) === true);
  }

  console.log("-- survives a missing window --");
  {
    // fromWebContents returns null once a window is gone; the handlers must not
    // throw into the renderer's invoke().
    currentWindow = null;
    let threw = false;
    try {
      await handlers["window:minimize"]({});
      await handlers["window:close"]({});
      check("is-maximized reports false", (await handlers["window:is-maximized"]({})) === false);
      check("toggle-maximize reports false", (await handlers["window:toggle-maximize"]({})) === false);
    } catch {
      threw = true;
    }
    check("no handler throws when the window is gone", !threw);
  }

  console.log("-- maximize state is pushed to the renderer --");
  {
    // This is what keeps the icon right after a double-click on the title bar,
    // a Win+Arrow snap, or a drag to a screen edge — none of which go through
    // our own button.
    check("main.js subscribes to the maximize event", /win\.on\("maximize"/.test(mainSrc));
    check("main.js subscribes to the unmaximize event", /win\.on\("unmaximize"/.test(mainSrc));
    check(
      "it sends window:maximize-changed",
      /webContents\.send\(\s*"window:maximize-changed"/.test(mainSrc),
      "not found in main.js",
    );
    check(
      "it guards against a destroyed window",
      /isDestroyed\(\)/.test(mainSrc),
      "sending to a destroyed webContents throws",
    );
  }

  console.log("-- platform-specific frame config --");
  {
    check("branches on process.platform", /process\.platform === "darwin"/.test(mainSrc));
    check("macOS uses hiddenInset", /titleBarStyle:\s*"hiddenInset"/.test(mainSrc));
    check("non-macOS uses frame: false", /frame:\s*false/.test(mainSrc));
    // WS_THICKFRAME is what Aero Snap, Win+Arrow and edge-resize hang off.
    // Dropping it is the classic "snapping broke" frameless-window bug.
    check("keeps thickFrame so Windows snapping survives", /thickFrame:\s*true/.test(mainSrc));
    check(
      "macOS does NOT also get frame: false",
      /if \(isMac\) return \{ titleBarStyle: "hiddenInset" \};/.test(mainSrc),
      "macOS must keep its native traffic lights",
    );
  }

  console.log("-- preload surface --");
  {
    check("exposes windowControls", /windowControls:\s*\{/.test(preloadSrc));
    for (const [name, channel] of [
      ["minimize", "window:minimize"],
      ["toggleMaximize", "window:toggle-maximize"],
      ["close", "window:close"],
      ["isMaximized", "window:is-maximized"],
    ]) {
      check(`${name} invokes ${channel}`, preloadSrc.includes(`invoke("${channel}")`), channel);
    }
    check("exposes onMaximizeChange", /onMaximizeChange:/.test(preloadSrc));
    check("exposes platform", /platform:\s*process\.platform/.test(preloadSrc));
    check(
      "onMaximizeChange returns an unsubscribe",
      /removeListener\("window:maximize-changed"/.test(preloadSrc),
      "listener would leak across remounts",
    );
  }

  console.log("-- title bar drag regions --");
  {
    // Without app-no-drag the OS consumes the mousedown before the DOM sees
    // it, so the buttons render correctly and simply never fire.
    check("bar is a drag region", /app-drag/.test(titleBarSrc));
    check("buttons opt out of dragging", /app-no-drag/.test(titleBarSrc));
    check("no buttons drawn on macOS", /const showButtons = !isMac/.test(titleBarSrc));
    check("macOS label clears the traffic lights", /isMac && "pl-20"/.test(titleBarSrc));
    check("seeds from the real window state", /isMaximized\(\)/.test(titleBarSrc));
    check("subscribes to external changes", /onMaximizeChange/.test(titleBarSrc));
  }

  console.log("-- css utilities back the drag regions --");
  {
    const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");
    check("app-drag sets drag", /\.app-drag\s*\{[^}]*-webkit-app-region:\s*drag/.test(css));
    check("app-no-drag sets no-drag", /\.app-no-drag\s*\{[^}]*-webkit-app-region:\s*no-drag/.test(css));
  }

  console.log("-- scrollbars are themed globally --");
  {
    const css = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");
    check("firefox syntax present", /scrollbar-width:\s*thin/.test(css));
    check("firefox colour uses tokens", /scrollbar-color:\s*var\(--border-strong\)/.test(css));
    check("webkit thumb uses tokens", /::-webkit-scrollbar-thumb\s*\{[^}]*var\(--border-strong\)/.test(css));
    check("webkit hover uses tokens", /::-webkit-scrollbar-thumb:hover\s*\{[^}]*var\(--subtle-foreground\)/.test(css));
    // Global, not attached to a helper class, so every scroll container in the
    // app is themed including ones added later.
    check("rules are global, not component-scoped", !/\.scroll-slim/.test(css));
    check("no hardcoded hex colours in the scrollbar rules", !/::-webkit-scrollbar[^}]*#[0-9a-f]{3,6}/i.test(css));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
