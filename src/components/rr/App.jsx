import { useCallback, useEffect, useRef, useState } from "react";
import { FlaskConical, GitCompareArrows, History, Radar, Settings2 } from "lucide-react";
import GenerateTab from "./GenerateTab";
import HistoryTab from "./HistoryTab";
import SettingsTab from "./SettingsTab";
import { getSettings, setDemoMode } from "@/lib/api.js";
import { Callout } from "./ui";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "generate", label: "Generate", icon: GitCompareArrows },
  { id: "history", label: "History", icon: History },
  { id: "settings", label: "Settings", icon: Settings2 },
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

  const tabRefs = useRef({});

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

  // The WAI-ARIA tabs pattern expects arrow keys to move between tabs, with
  // Home/End jumping to the ends. Without this the roles are a promise the
  // markup doesn't keep, which is worse for a screen-reader user than no roles.
  const onTabKeyDown = (event) => {
    const order = TABS.map((t) => t.id);
    const index = order.indexOf(tab);
    const moves = { ArrowRight: 1, ArrowLeft: -1 };

    let next = null;
    if (event.key in moves) next = order[(index + moves[event.key] + order.length) % order.length];
    else if (event.key === "Home") next = order[0];
    else if (event.key === "End") next = order[order.length - 1];
    if (!next) return;

    event.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky masthead: at 900px tall with a 280px commit list, the tabs
          scrolled away exactly when you needed them. */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 pb-0 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground"
            >
              <Radar className="size-4" />
            </span>
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-base font-semibold tracking-tight">Release Radar</h1>
              <p className="truncate text-xs text-muted-foreground">
                Commit range to publish-ready changelog
              </p>
            </div>
          </div>

          {demo ? (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-sm bg-accent-surface px-2 py-1 text-2xs font-semibold text-accent ring-1 ring-accent/25 ring-inset">
              <FlaskConical className="size-3.5" aria-hidden="true" />
              Demo data
            </span>
          ) : null}

          <nav
            role="tablist"
            aria-label="Sections"
            onKeyDown={onTabKeyDown}
            className="-mb-px flex w-full gap-0.5"
          >
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              // History and Settings mount lazily, so their panels are absent
              // until selected. aria-controls must point at an element that
              // actually exists, so it is only set when the panel is rendered.
              const panelMounted = id === "generate" || active;
              return (
                <button
                  key={id}
                  ref={(node) => {
                    tabRefs.current[id] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`tab-${id}`}
                  aria-selected={active}
                  aria-controls={panelMounted ? `panel-${id}` : undefined}
                  // Roving tabindex: only the active tab is in the tab order,
                  // arrows move between them. Part of the same ARIA pattern.
                  tabIndex={active ? 0 : -1}
                  onClick={() => setTab(id)}
                  className={cn(
                    "relative inline-flex items-center gap-2 rounded-t-md px-3 py-2.5 text-sm",
                    "transition-colors duration-150",
                    "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full",
                    "after:transition-colors after:duration-150",
                    active
                      ? "font-semibold text-foreground after:bg-accent"
                      : "font-medium text-muted-foreground after:bg-transparent hover:bg-hover hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6">
        {demo ? (
          <Callout
            tone="info"
            icon={FlaskConical}
            title="You're looking at demo data"
            className="mb-5"
          >
            Every repository, commit and changelog here is fabricated. No API calls are
            made and nothing can be published. Turn this off in Settings to work with
            real repositories.
          </Callout>
        ) : null}

        {/* Tabs stay mounted-on-demand: Generate holds a lot of in-flight
            state, so it is kept alive across tab switches.

            The `key` remounts the data tabs when demo mode flips, so
            already-fetched real data can never linger on screen next to demo
            data (or the reverse). */}
        <div
          role="tabpanel"
          id="panel-generate"
          aria-labelledby="tab-generate"
          hidden={tab !== "generate"}
        >
          <GenerateTab
            key={demo ? "demo" : "live"}
            prefill={prefill}
            onSaved={() => setReloadKey((n) => n + 1)}
          />
        </div>

        {tab === "history" && (
          <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
            <HistoryTab
              key={demo ? "demo" : "live"}
              reloadKey={reloadKey}
              onRegenerate={handleRegenerate}
            />
          </div>
        )}

        {tab === "settings" && (
          <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings">
            <SettingsTab onPreferencesChange={syncPreferences} />
          </div>
        )}
      </div>
    </div>
  );
}
