import { useEffect, useState } from "react";
import { Copy, Minus, Radar, Square, X } from "lucide-react";
import { windowControls } from "@/lib/api.js";
import { Button } from "./ui";
import { cn } from "@/lib/utils";

/**
 * The app's own title bar.
 *
 * The native frame is removed in electron/main.js because an OS-drawn title
 * bar cannot be themed — it stays light over a dark UI. That means everything
 * the frame used to provide has to be re-provided here.
 *
 * Platform differences, all deliberate:
 *
 *  - Windows/Linux: `frame: false`, so we draw minimise / maximise / close.
 *  - macOS: `titleBarStyle: "hiddenInset"`, so the native traffic lights are
 *    still there and still work. We draw NO buttons — two sets would be
 *    absurd — but we do inset the label so it clears them.
 *  - Browser (no Electron bridge): no buttons and no drag region. The real
 *    browser chrome is already doing this job.
 */

const DRAG_HEIGHT = "h-8";

function WindowButton({ label, onClick, danger = false, children }) {
  return (
    <Button
      // `app-no-drag` is load-bearing: inside a drag region the OS takes the
      // mouse down before the DOM sees it, so without this the buttons look
      // fine and simply never fire.
      variant="ghost"
      size="icon"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "app-no-drag h-8 w-11 rounded-none text-muted-foreground",
        // Close reads neutral at rest and only turns destructive on hover,
        // matching the platform convention. A permanently red X in the corner
        // reads as an error state.
        danger
          ? "hover:bg-danger-surface hover:text-danger"
          : "hover:text-foreground",
      )}
    >
      {children}
    </Button>
  );
}

export default function TitleBar() {
  const controls = windowControls();
  const platform = controls.platform;
  const isMac = platform === "darwin";
  const isWeb = platform === "web";
  const showButtons = !isMac && !isWeb;

  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!showButtons) return;
    let alive = true;

    // Seed from the real state: the window can be launched maximised, or
    // restored by the OS, before this component ever mounts.
    controls.isMaximized().then((v) => {
      if (alive) setMaximized(Boolean(v));
    });

    // Keeps the icon truthful when the state changes by any route other than
    // our own button — double-clicking the bar, Win+Arrow, dragging to an edge.
    const unsubscribe = controls.onMaximizeChange((v) => {
      if (alive) setMaximized(Boolean(v));
    });

    return () => {
      alive = false;
      // Older preloads returned the ipcRenderer here rather than an
      // unsubscribe, so only call it if it actually is one.
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [controls, showButtons]);

  return (
    <div
      className={cn(
        "app-drag sticky top-0 z-30 flex shrink-0 items-center justify-between",
        "border-b border-border bg-background",
        DRAG_HEIGHT,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 items-center gap-2 pl-3",
          // Clear macOS's traffic lights, which are drawn over the top-left of
          // the content area by titleBarStyle: "hiddenInset".
          isMac && "pl-20",
        )}
      >
        <Radar className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        {/* Chrome, not content: small and muted so it reads as a window title
            rather than competing with the page heading below it. */}
        <span className="truncate text-2xs font-medium tracking-wide text-muted-foreground">
          Release Radar
        </span>
      </div>

      {showButtons ? (
        <div className="flex shrink-0 items-center">
          <WindowButton label="Minimise" onClick={() => controls.minimize()}>
            <Minus aria-hidden="true" />
          </WindowButton>

          <WindowButton
            label={maximized ? "Restore" : "Maximise"}
            onClick={async () => {
              // The handler returns the resulting state, so the icon is right
              // even if the maximize/unmaximize event is missed.
              const next = await controls.toggleMaximize();
              setMaximized(Boolean(next));
            }}
          >
            {maximized ? (
              // Two offset squares — the conventional "restore down" glyph.
              <Copy aria-hidden="true" />
            ) : (
              <Square aria-hidden="true" />
            )}
          </WindowButton>

          <WindowButton label="Close" danger onClick={() => controls.close()}>
            <X aria-hidden="true" />
          </WindowButton>
        </div>
      ) : null}
    </div>
  );
}
