import { useEffect, useState } from "react";
import GenerateTab from "./GenerateTab";
import HistoryTab from "./HistoryTab";
import SettingsTab from "./SettingsTab";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "generate", label: "Generate" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

// styles.css declares `@custom-variant dark (&:is(.dark *))`, so dark utilities
// only apply beneath an element carrying `.dark`. Nothing else sets it, so the
// shell owns keeping it in sync with the OS theme.
function useSystemTheme() {
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (isDark) => {
      document.documentElement.classList.toggle("dark", isDark);
    };
    apply(query.matches);
    const onChange = (event) => apply(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
}

export default function App() {
  const [tab, setTab] = useState("generate");
  // Bumped whenever a changelog is generated, so History refetches on next view.
  const [reloadKey, setReloadKey] = useState(0);
  const [prefill, setPrefill] = useState(null);

  useSystemTheme();

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
              state, so it is kept alive across tab switches. */}
          <div hidden={tab !== "generate"}>
            <GenerateTab prefill={prefill} onSaved={() => setReloadKey((n) => n + 1)} />
          </div>
          {tab === "history" && (
            <HistoryTab reloadKey={reloadKey} onRegenerate={handleRegenerate} />
          )}
          {tab === "settings" && <SettingsTab />}
        </main>
      </div>
    </div>
  );
}
