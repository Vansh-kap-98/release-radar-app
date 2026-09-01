const { safeStorage } = require("electron");
const Store = require("electron-store");

// electron-store just picks a JSON file location for us; safeStorage is
// what actually encrypts values at rest using the OS keychain (Keychain
// on macOS, DPAPI on Windows, libsecret on Linux). Values are never
// written to disk in plain text.
const store = new Store({ name: "release-radar-settings" });

// Secrets: encrypted at rest, and never handed back to the renderer.
const SECRET_KEYS = ["githubToken", "aiApiKey", "slackWebhookUrl"];

// Preferences: not secrets, so they are stored as-is and CAN be read back by
// the renderer (the UI needs their actual values to render the right state).
// They are still written through the same record shape as secrets, so
// getSecret() reads both without caring which kind a key is — and so settings
// written by an older build keep loading.
const PLAIN_KEYS = ["aiProvider", "demoMode", "theme", "githubApiBaseUrl"];

const SETTING_KEYS = [...SECRET_KEYS, ...PLAIN_KEYS];

// Defaults are defined here rather than at each call site so "what happens
// when this was never set" has exactly one answer. Every default reproduces
// the behavior that existed before these keys were added.
const DEFAULTS = {
  aiProvider: "anthropic",
  demoMode: "", // off — the app talks to real APIs unless asked not to
  theme: "system", // follow the OS, which is what the app always did
  githubApiBaseUrl: "" // blank resolves to https://api.github.com in core/
};

function setSecret(key, value) {
  if (!SETTING_KEYS.includes(key)) throw new Error(`Unknown setting key: ${key}`);
  if (!value) {
    store.delete(key);
    return;
  }

  // Only secrets pay for encryption. Encrypting a preference would mean a
  // keychain round-trip on every read for a value that isn't sensitive.
  if (!SECRET_KEYS.includes(key)) {
    store.set(key, { encrypted: false, data: String(value) });
    return;
  }

  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString("base64")
    : value; // fallback: still local-only, but unencrypted if OS support is missing
  store.set(key, { encrypted: safeStorage.isEncryptionAvailable(), data: encrypted });
}

function getSecret(key) {
  const record = store.get(key);
  if (!record) return DEFAULTS[key] ?? null;
  if (!record.encrypted) return record.data;
  return safeStorage.decryptString(Buffer.from(record.data, "base64"));
}

// Returns which SECRETS are set (booleans only) — never the actual secret
// values — so the Settings screen can show "configured" state without ever
// pulling raw keys back into the renderer. Preferences are returned as their
// real values, because they are not sensitive and the UI needs them.
function getAll() {
  const result = {};
  for (const key of SECRET_KEYS) {
    result[key] = Boolean(store.get(key));
  }

  result.aiProviderValue = getSecret("aiProvider");
  result.demoMode = Boolean(getSecret("demoMode"));
  result.theme = getSecret("theme");
  result.githubApiBaseUrl = getSecret("githubApiBaseUrl");

  return result;
}

module.exports = { setSecret, getSecret, getAll, SECRET_KEYS, PLAIN_KEYS, SETTING_KEYS, DEFAULTS };
