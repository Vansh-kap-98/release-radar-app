import { useEffect, useState } from "react";
import { getSettings, setSetting } from "@/lib/api.js";
import { Badge, Button, ErrorText, Input, Label, Panel, Select, Toggle } from "./ui";

const DEFAULT_API_BASE_URL = "https://api.github.com";

const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function StatusBadge({ configured }) {
  return (
    <Badge tone={configured ? "ok" : "muted"}>{configured ? "configured" : "not set"}</Badge>
  );
}

// A blank value is the default and means api.github.com. Anything else has to
// be an absolute http(s) URL — a bare hostname would silently produce a
// relative fetch, which fails in a confusing way much later.
function validateApiBaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Enter a full URL, for example https://ghe.example.com/api/v3";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "The URL must start with https:// (or http:// on an internal network).";
  }
  return "";
}

export default function SettingsTab({ onPreferencesChange }) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const [githubToken, setGithubToken] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [aiProvider, setAiProvider] = useState("anthropic");

  const [theme, setTheme] = useState("system");
  const [demoMode, setDemoModeState] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState("");

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setAiProvider(s.aiProviderValue);
        setTheme(s.theme || "system");
        setDemoModeState(Boolean(s.demoMode));
        setApiBaseUrl(s.githubApiBaseUrl || "");
      })
      .catch((e) => alive && setError(e?.message || "Could not load settings."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const apiBaseUrlError = validateApiBaseUrl(apiBaseUrl);

  const save = async () => {
    if (apiBaseUrlError) {
      setError(apiBaseUrlError);
      return;
    }
    setSaving(true);
    setError("");
    setSaved("");
    try {
      await setSetting("aiProvider", aiProvider);
      await setSetting("theme", theme);
      // Stored as a string because the settings store treats a falsy value as
      // "delete this key", which is exactly the right behavior for "off".
      await setSetting("demoMode", demoMode ? "true" : "");
      await setSetting("githubApiBaseUrl", apiBaseUrl.trim());
      if (githubToken) await setSetting("githubToken", githubToken);
      if (aiApiKey) await setSetting("aiApiKey", aiApiKey);
      if (slackWebhookUrl) await setSetting("slackWebhookUrl", slackWebhookUrl);
      setGithubToken("");
      setAiApiKey("");
      setSlackWebhookUrl("");
      setSettings(await getSettings());
      setSaved("Settings saved.");
      // Theme and demo mode are owned by the shell, so tell it to re-read.
      await onPreferencesChange?.();
    } catch (e) {
      setError(e?.message || "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Panel className="text-[13px] text-muted-foreground">Loading settings...</Panel>;
  }

  return (
    <div className="space-y-4">
      <Panel className="space-y-4">
        <h2 className="text-[13px] font-semibold">Credentials</h2>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <Label htmlFor="gh" className="mb-0">
              GitHub token
            </Label>
            <StatusBadge configured={settings?.githubToken} />
          </div>
          <Input
            id="gh"
            type="password"
            autoComplete="off"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            placeholder="ghp_..."
            className="font-mono"
          />
        </div>

        <div>
          <Label htmlFor="provider">AI provider</Label>
          <Select
            id="provider"
            value={aiProvider}
            onChange={(e) => setAiProvider(e.target.value)}
            className="w-full"
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
            <option value="groq">Groq</option>
            <option value="google">Google (Gemini)</option>
          </Select>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <Label htmlFor="aikey" className="mb-0">
              AI API key
            </Label>
            <StatusBadge configured={settings?.aiApiKey} />
          </div>
          <Input
            id="aikey"
            type="password"
            autoComplete="off"
            value={aiApiKey}
            onChange={(e) => setAiApiKey(e.target.value)}
            placeholder="sk-..."
            className="font-mono"
          />
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <Label htmlFor="slack" className="mb-0">
              Slack webhook URL
            </Label>
            <Badge>optional</Badge>
            <StatusBadge configured={settings?.slackWebhookUrl} />
          </div>
          <Input
            id="slack"
            type="password"
            autoComplete="off"
            value={slackWebhookUrl}
            onChange={(e) => setSlackWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="font-mono"
          />
        </div>
      </Panel>

      <Panel className="space-y-4">
        <h2 className="text-[13px] font-semibold">Preferences</h2>

        <Toggle
          id="demoMode"
          checked={demoMode}
          onChange={setDemoModeState}
          label="Try demo data"
          description="Fills the app with a fabricated repository so you can see the whole flow before adding any API key. No network calls are made and nothing is published."
        />

        <div>
          <Label htmlFor="theme">Theme</Label>
          <Select
            id="theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            className="w-full"
          >
            {THEMES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[12px] text-muted-foreground">
            System follows your OS setting, which is what the app has always done.
          </p>
        </div>

        <div>
          <div className="mb-1 flex items-center gap-2">
            <Label htmlFor="apiBase" className="mb-0">
              GitHub API base URL
            </Label>
            <Badge>advanced</Badge>
          </div>
          <Input
            id="apiBase"
            autoComplete="off"
            spellCheck={false}
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder={DEFAULT_API_BASE_URL}
            className="font-mono"
            aria-invalid={Boolean(apiBaseUrlError)}
          />
          <p className="mt-1 text-[12px] text-muted-foreground">
            Leave blank for GitHub.com. For GitHub Enterprise Server use your
            appliance's API root, for example{" "}
            <span className="font-mono">https://ghe.example.com/api/v3</span>.
          </p>
          <ErrorText>{apiBaseUrlError}</ErrorText>
        </div>
      </Panel>

      <Panel className="space-y-3">
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving || Boolean(apiBaseUrlError)}>
            {saving ? "Saving..." : "Save settings"}
          </Button>
          {saved ? <span className="text-[12px] text-cat-feat">{saved}</span> : null}
        </div>
        <ErrorText>{error}</ErrorText>
      </Panel>

      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Keys never leave your computer except to call GitHub's and your chosen AI provider's
        APIs directly. Nothing is sent to any Release Radar server — there isn't one.
      </p>
    </div>
  );
}
