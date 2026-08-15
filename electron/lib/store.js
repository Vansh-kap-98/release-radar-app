const { safeStorage } = require("electron");
const Store = require("electron-store");

// electron-store just picks a JSON file location for us; safeStorage is
// what actually encrypts values at rest using the OS keychain (Keychain
// on macOS, DPAPI on Windows, libsecret on Linux). Values are never
// written to disk in plain text.
const store = new Store({ name: "release-radar-settings" });

const SETTING_KEYS = ["githubToken", "aiProvider", "aiApiKey", "slackWebhookUrl"];

function setSecret(key, value) {
  if (!SETTING_KEYS.includes(key)) throw new Error(`Unknown setting key: ${key}`);
  if (!value) {
    store.delete(key);
    return;
  }
  const encrypted = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString("base64")
    : value; // fallback: still local-only, but unencrypted if OS support is missing
  store.set(key, { encrypted: safeStorage.isEncryptionAvailable(), data: encrypted });
}

function getSecret(key) {
  const record = store.get(key);
  if (!record) return null;
  if (!record.encrypted) return record.data;
  return safeStorage.decryptString(Buffer.from(record.data, "base64"));
}

// Returns which settings are SET (booleans only) — never the actual
// secret values — so the Settings screen can show "configured" state
// without ever pulling raw keys back into the renderer unnecessarily.
function getAll() {
  const result = {};
  for (const key of SETTING_KEYS) {
    result[key] = Boolean(store.get(key));
  }
  // aiProvider is not a secret, safe to return directly for the dropdown.
  const providerRecord = store.get("aiProvider");
  result.aiProviderValue = providerRecord ? getSecret("aiProvider") : "anthropic";
  return result;
}

module.exports = { setSecret, getSecret, getAll };
