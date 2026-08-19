import { useEffect, useState } from "react";
import { getSettings, setSetting } from "@/lib/api.js";
import { Badge, Button, ErrorText, Input, Label, Panel, Select } from "./ui";

function StatusBadge({ configured }) {
  return (
    <Badge tone={configured ? "ok" : "muted"}>{configured ? "configured" : "not set"}</Badge>
  );
}

export default function SettingsTab() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const [githubToken, setGithubToken] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [aiProvider, setAiProvider] = useState("anthropic");

  useEffect(() => {
    let alive = true;
    getSettings()
      .then((s) => {
        if (!alive) return;
        setSettings(s);
        setAiProvider(s.aiProviderValue);
      })
      .catch((e) => alive && setError(e?.message || "Could not load settings."))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved("");
    try {
      await setSetting("aiProvider", aiProvider);
      if (githubToken) await setSetting("githubToken", githubToken);
      if (aiApiKey) await setSetting("aiApiKey", aiApiKey);
      if (slackWebhookUrl) await setSetting("slackWebhookUrl", slackWebhookUrl);
      setGithubToken("");
      setAiApiKey("");
      setSlackWebhookUrl("");
      setSettings(await getSettings());
      setSaved("Settings saved.");
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

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
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
