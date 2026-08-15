import React, { useEffect, useState } from "react";

export default function SettingsForm({ onSaved }) {
  const [status, setStatus] = useState(null);
  const [githubToken, setGithubToken] = useState("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");
  const [aiProvider, setAiProvider] = useState("anthropic");
  const [aiApiKey, setAiApiKey] = useState("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");
  const [slackWebhookUrl, setSlackWebhookUrl] = useState("");
  const [configured, setConfigured] = useState({});

  useEffect(() => {
    window.releaseRadar.getSettings().then((settings) => {
      setConfigured(settings);
      setAiProvider(settings.aiProviderValue || "anthropic");
    });
  }, []);

  async function save() {
    if (githubToken) await window.releaseRadar.setSetting("githubToken", githubToken);
    await window.releaseRadar.setSetting("aiProvider", aiProvider);
    if (aiApiKey) await window.releaseRadar.setSetting("aiApiKey", aiApiKey);
    if (slackWebhookUrl) await window.releaseRadar.setSetting("slackWebhookUrl", slackWebhookUrl);
    setStatus("Saved. Keys are encrypted and stored locally only.");
    setGithubToken("");
    setAiApiKey("");
    setSlackWebhookUrl("");
    const fresh = await window.releaseRadar.getSettings();
    setConfigured(fresh);
    onSaved?.();
  }

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 480 }}>
      <label>
        GitHub token {configured.githubToken ? "✓ configured" : "(not set)"}
        <input
          type="password"
          placeholder="ghp_..."
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
      </label>

      <label>
        AI provider
        <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)} style={{ display: "block", width: "100%" }}>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
          <option value="groq">Groq</option>
        </select>
      </label>

      <label>
        AI API key {configured.aiApiKey ? "✓ configured" : "(not set)"}
        <input
          type="password"
          placeholder="sk-..."
          value={aiApiKey}
          onChange={(e) => setAiApiKey(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
      </label>

      <label>
        Slack webhook URL — optional {configured.slackWebhookUrl ? "✓ configured" : "(not set)"}
        <input
          type="password"
          placeholder="https://hooks.slack.com/..."
          value={slackWebhookUrl}
          onChange={(e) => setSlackWebhookUrl(e.target.value)}
          style={{ display: "block", width: "100%" }}
        />
      </label>

      <button onClick={save}>Save settings</button>
      {status && <p style={{ color: "green" }}>{status}</p>}
      <p style={{ fontSize: 12, color: "#666" }}>
        Keys never leave your computer except to call GitHub's and your chosen AI
        provider's APIs directly. Nothing is sent to any Release Radar server —
        there isn't one.
      </p>
    </div>
  );
}
