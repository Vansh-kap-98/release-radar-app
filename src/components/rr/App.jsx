import { useCallback, useEffect, useState } from "react";
import GenerateTab from "./GenerateTab";
import HistoryTab from "./HistoryTab";
import SettingsTab from "./SettingsTab";
import { getSettings, setDemoMode } from "@/lib/api.js";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "generate", label: "Generate" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

// styles.css declares `@custom-variant dark (&:is(.dark *))`, so dark utilities
// only apply beneath an element carrying `.dark`. Nothing else sets it, so the
// shell owns keeping it in sync.
//
// `preference` is "system" | "light" | "dark". "system" is the default and
// reproduces the original matchMedia-only behavior exactly, so an existing
// user who never opens the new setting sees no change. The other two pin the
// theme and stop listening to the OS.
function useTheme(preference) {
  useEffect(() => {
    const apply = (isDark) => {
      document.documentElement.classList.toggle("dark", isDark);
    };

    if (preference === "light" || preference === "dark") {
      apply(preference === "dark");
      return;
    }

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    apply(query.matches);
    const onChange = (event) => apply(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);
}

export default function App() {
  const [tab, setTab] = useState("generate");
  // Bumped whenever a changelog is generated, so History refetches on next view.
  const [reloadKey, setReloadKey] = useState(0);
  const [prefill, setPrefill] = useState(null);

  // App-level preferences, loaded once and refreshed when Settings saves.
  // Defaults here match the store's defaults, so the first render before
  // settings arrive already behaves the way it always did.
  const [theme, setTheme] = useState("system");
  const [demo, setDemo] = useState(false);

  const syncPreferences = useCallback(async () => {
    try {
      const s = await getSettings();
      setTheme(s?.theme || "system");
      const on = Boolean(s?.demoMode);
      // api.js reads this synchronously on every data call, so it has to be
      // set before the tabs below re-render and start fetching.
      setDemoMode(on);
      setDemo(on);
    } catch {
      // A settings read failure must not blank the app — keep the defaults,
      // which are the pre-existing behavior.
    }
  }, []);

  useEffect(() => {
    syncPreferences();
  }, [syncPreferences]);

  useTheme(theme);

  const handleRegenerate = (entry) => {
    // A fresh object identity each time, so regenerating the same entry twice
    // still registers as a new request in GenerateTab.
    setPrefill({ ...entry });
    setTab("generate");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[860px] px-6 py-6">
        <header className="mb-5">
          <h1 className="text-lg font-semibold tracking-tight">Release Radar</h1>
          <p className="text-sm text-muted-foreground">
            Turn a commit range into a publish-ready changelog.
          </p>
        </header>

        {demo ? (
          <div
            role="status"
            className="mb-5 rounded-md border border-cat-docs/40 bg-cat-docs-bg/40 px-3 py-2 text-[12px]"
          >
            <span className="font-semibold">Demo data.</span> Every repository,
            commit and changelog below is fabricated. No API calls are made and
            nothing is published. Turn this off in Settings to use real repositories.
          </div>
        ) : null}

        <nav className="mb-6 flex gap-1 border-b border-border" role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        <main>
          {/* Tabs stay mounted-on-demand: Generate holds a lot of in-flight
              state, so it is kept alive across tab switches.

              The `key` remounts the data tabs when demo mode flips, so
              already-fetched real data can never linger on screen next to demo
              data (or the reverse). */}
          <div hidden={tab !== "generate"}>
            <GenerateTab
              key={demo ? "demo" : "live"}
              prefill={prefill}
              onSaved={() => setReloadKey((n) => n + 1)}
            />
          </div>
          {tab === "history" && (
            <HistoryTab
              key={demo ? "demo" : "live"}
              reloadKey={reloadKey}
              onRegenerate={handleRegenerate}
            />
          )}
          {tab === "settings" && <SettingsTab onPreferencesChange={syncPreferences} />}
        </main>
      </div>
    </div>
  );
}
