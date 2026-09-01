import { useEffect, useState } from "react";
import {
  Check,
  ExternalLink,
  FlaskConical,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Server,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { getSettings, openTokenCreationUrl, setSetting } from "@/lib/api.js";
import { Badge, Button, ErrorText, Field, Input, Panel, Select, Toggle } from "./ui";
import { cn } from "@/lib/utils";

const DEFAULT_API_BASE_URL = "https://api.github.com";

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function StatusBadge({ configured }) {
  return (
    <Badge tone={configured ? "success" : "outline"}>
      {configured ? "configured" : "not set"}
    </Badge>
  );
}

/**
 * A settings row: description on the left, control on the right, aligned to a
 * shared grid. This is the layout change that most separates a settings screen
 * from a signup form — the reader scans one column of labels, not an
 * alternating stack of full-width inputs.
 */
function Row({ label, description, htmlFor, badge, children, className, labelable = true }) {
  // `labelable: false` for rows whose control is a button (the switch, the
  // theme segmented control). A <label for> does not activate a button, so
  // those rows expose the text via aria-labelledby instead of faking it.
  const labelId = `${htmlFor}-label`;
  const LabelTag = labelable ? "label" : "span";
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-2 px-4 py-4 sm:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <LabelTag
            id={labelId}
            htmlFor={labelable ? htmlFor : undefined}
            className="text-sm font-medium text-foreground"
          >
            {label}
          </LabelTag>
          {badge}
        </div>
        {description ? (
          <p className="mt-1 max-w-[52ch] text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      <div className="min-w-0 sm:pt-0.5">{children}</div>
    </div>
  );
}

function SectionHeading({ icon: Icon, title, children }) {
  return (
    <div className="flex items-start gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {children ? (
          <p className="mt-0.5 max-w-[70ch] text-xs text-muted-foreground">{children}</p>
        ) : null}
      </div>
    </div>
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

// The host the "generate a token" button will actually open. Normally
// github.com; on Enterprise Server it is the appliance, because a token minted
// on github.com is useless against GHES.
function tokenHostLabel(apiBaseUrl) {
  const trimmed = (apiBaseUrl || "").trim();
  if (!trimmed) return "github.com";
  try {
    return new URL(trimmed).host;
  } catch {
    return "github.com";
  }
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

  const [tokenLinkError, setTokenLinkError] = useState("");

  const apiBaseUrlError = validateApiBaseUrl(apiBaseUrl);

  const openTokenPage = async () => {
    setTokenLinkError("");
    try {
      await openTokenCreationUrl();
    } catch (e) {
      setTokenLinkError(
        e?.message || "Could not open your browser. Visit github.com/settings/tokens/new manually.",
      );
    }
  };

  // Advisory only — the Save button stays enabled regardless, so this changes
  // nothing about what saving does. It just answers "did I actually change
  // anything?", which a form with three secret fields can't otherwise show.
  const dirty =
    Boolean(settings) &&
    (aiProvider !== settings.aiProviderValue ||
      theme !== (settings.theme || "system") ||
      demoMode !== Boolean(settings.demoMode) ||
      apiBaseUrl.trim() !== (settings.githubApiBaseUrl || "") ||
      Boolean(githubToken || aiApiKey || slackWebhookUrl));

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
    return (
      <Panel>
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Loading settings…
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4 pb-20">
      <Panel flush>
        <SectionHeading icon={KeyRound} title="Credentials">
          Stored encrypted on this machine and sent only to GitHub and your chosen AI
          provider.
        </SectionHeading>

        <div className="divide-y divide-border">
          <Row
            label="GitHub token"
            htmlFor="gh"
            badge={<StatusBadge configured={settings?.githubToken} />}
            description="Needs Contents and Pull requests write access to open a changelog PR."
          >
            <div className="space-y-3">
              {/* Shortcut to GitHub's token form with the description and the
                  `repo` scope already filled in. It does NOT fetch the token
                  back — GitHub shows a new token once, on its own page, and
                  offers no way to hand it to us — so the paste field below
                  stays exactly as it was. */}
              <div className="space-y-1.5">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={openTokenPage}
                  className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left"
                >
                  <ExternalLink aria-hidden="true" />
                  <span>
                    Generate a GitHub token for Release Radar{" "}
                    <span className="font-normal text-muted-foreground">
                      (opens {tokenHostLabel(apiBaseUrl)})
                    </span>
                  </span>
                </Button>
                <p className="max-w-[52ch] text-xs leading-relaxed text-muted-foreground">
                  This opens GitHub with the right permissions pre-selected — review them,
                  click Generate, then paste the token below.
                </p>
                <ErrorText>{tokenLinkError}</ErrorText>
              </div>

              <Input
                id="gh"
                type="password"
                autoComplete="off"
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                placeholder={settings?.githubToken ? "••••••••  (leave blank to keep)" : "ghp_…"}
                className="font-mono"
              />
            </div>
          </Row>

          <Row
            label="AI provider"
            htmlFor="provider"
            labelable={false}
            description="Which model classifies commits and formats the notes."
          >
            <Select
              id="provider"
              aria-labelledby="provider-label"
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value)}
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI</option>
              <option value="groq">Groq</option>
              <option value="google">Google (Gemini)</option>
            </Select>
          </Row>

          <Row
            label="AI API key"
            htmlFor="aikey"
            badge={<StatusBadge configured={settings?.aiApiKey} />}
            description="A key for the provider selected above."
          >
            <Input
              id="aikey"
              type="password"
              autoComplete="off"
              value={aiApiKey}
              onChange={(e) => setAiApiKey(e.target.value)}
              placeholder={settings?.aiApiKey ? "••••••••  (leave blank to keep)" : "sk-…"}
              className="font-mono"
            />
          </Row>

          <Row
            label="Slack webhook"
            htmlFor="slack"
            badge={
              <>
                <Badge tone="neutral">optional</Badge>
                <StatusBadge configured={settings?.slackWebhookUrl} />
              </>
            }
            description="Only needed for the “Post to Slack” publish target."
          >
            <Input
              id="slack"
              type="password"
              autoComplete="off"
              value={slackWebhookUrl}
              onChange={(e) => setSlackWebhookUrl(e.target.value)}
              placeholder={
                settings?.slackWebhookUrl
                  ? "••••••••  (leave blank to keep)"
                  : "https://hooks.slack.com/services/…"
              }
              className="font-mono"
            />
          </Row>
        </div>
      </Panel>

      <Panel flush>
        <SectionHeading icon={FlaskConical} title="Preferences" />

        <div className="divide-y divide-border">
          <Row
            label="Demo data"
            htmlFor="demoMode"
            labelable={false}
            description="Fills the app with a made-up repository so you can see the whole flow before adding any API key. No network calls are made and nothing is published."
          >
            <Toggle
              id="demoMode"
              checked={demoMode}
              onChange={setDemoModeState}
              aria-labelledby="demoMode-label"
            />
          </Row>

          <Row
            label="Theme"
            htmlFor="theme"
            labelable={false}
            description="System follows your operating system, which is the default."
          >
            {/* Segmented control rather than a dropdown: three fixed options
                that benefit from being visible at once. */}
            <div
              role="radiogroup"
              aria-labelledby="theme-label"
              className="inline-flex rounded-md border border-input bg-muted/60 p-0.5 shadow-xs"
            >
              {THEMES.map(({ value, label, icon: Icon }) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium",
                      "transition-colors duration-150",
                      active
                        ? "bg-card text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          </Row>
        </div>
      </Panel>

      <Panel flush>
        <SectionHeading icon={Server} title="Advanced">
          Leave these alone unless you are on GitHub Enterprise Server.
        </SectionHeading>

        <div className="divide-y divide-border">
          <Row
            label="GitHub API base URL"
            htmlFor="apiBase"
            description="Blank uses GitHub.com. On Enterprise Server, point this at your appliance's API root."
          >
            <Field htmlFor="apiBase" error={apiBaseUrlError} hint="For example https://ghe.example.com/api/v3">
              {({ describedBy }) => (
                <Input
                  id="apiBase"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiBaseUrl}
                  onChange={(e) => setApiBaseUrl(e.target.value)}
                  placeholder={DEFAULT_API_BASE_URL}
                  className="font-mono"
                  aria-invalid={Boolean(apiBaseUrlError)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
          </Row>
        </div>
      </Panel>

      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <span className="max-w-[70ch]">
          Keys never leave your computer except to call GitHub's and your chosen AI
          provider's APIs directly. Nothing is sent to any Release Radar server — there
          isn't one.
        </span>
      </p>

      {/* Save is pinned rather than stranded at the bottom of a long form, so
          it is reachable without scrolling back down after every edit. */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <Button variant="primary" size="md" onClick={save} loading={saving} disabled={Boolean(apiBaseUrlError)}>
            {!saving ? <Check aria-hidden="true" /> : null}
            {saving ? "Saving…" : "Save settings"}
          </Button>

          {saved ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
              <Check className="size-3.5" aria-hidden="true" />
              {saved}
            </span>
          ) : dirty ? (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          ) : null}

          <div className="ml-auto min-w-0">
            <ErrorText>{error}</ErrorText>
          </div>
        </div>
      </div>
    </div>
  );
}
