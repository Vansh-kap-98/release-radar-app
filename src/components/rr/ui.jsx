import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronsUpDown, Info, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * Shared primitives.
 *
 * The point of this file is that button height, icon size, radius and padding
 * are decided ONCE per size step and reused, rather than guessed per component.
 * If a screen needs a control that isn't here, add it here — a one-off
 * `<button className="...">` in a tab is how the app drifted before.
 *
 * Icon sizing is enforced by the container via `[&_svg]:size-*`, so callers can
 * drop a lucide icon in as a child without passing a size and still get the
 * right one for that control.
 */

/* ---------------------------------- button --------------------------------- */

const BUTTON_VARIANTS = {
  // Solid neutral. The commit action: confirm, save, run.
  primary:
    "bg-primary text-primary-foreground border border-transparent " +
    "hover:opacity-88 active:opacity-95 " +
    "disabled:opacity-40",
  // Bordered surface. The default for anything non-committal.
  secondary:
    "bg-card text-foreground border border-input shadow-xs " +
    "hover:bg-hover hover:border-border-strong active:bg-muted " +
    "disabled:opacity-45 disabled:shadow-none",
  // Chromeless. For tertiary actions that shouldn't compete.
  ghost:
    "bg-transparent text-muted-foreground border border-transparent " +
    "hover:bg-hover hover:text-foreground active:bg-muted " +
    "disabled:opacity-45",
  // Destructive intent, but still quiet until hovered — deletes here are local.
  danger:
    "bg-transparent text-danger border border-transparent " +
    "hover:bg-danger-surface hover:border-danger/25 active:bg-danger-surface " +
    "disabled:opacity-45",
};

const BUTTON_SIZES = {
  sm: "h-7 gap-1.5 rounded-md px-2.5 text-xs [&_svg]:size-3.5",
  md: "h-8 gap-1.5 rounded-md px-3 text-sm [&_svg]:size-4",
  lg: "h-9 gap-2 rounded-md px-4 text-sm [&_svg]:size-4",
  // Square, for icon-only actions. Callers MUST pass an aria-label.
  icon: "h-7 w-7 rounded-md [&_svg]:size-4",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  loading = false,
  children,
  disabled,
  ...props
}) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap",
        // Only the properties that actually change — `transition-all` animates
        // layout and makes the whole UI feel laggy under load.
        "transition-[background-color,border-color,color,opacity] duration-150",
        "disabled:pointer-events-none disabled:cursor-not-allowed",
        "[&_svg]:shrink-0",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/* ---------------------------------- inputs --------------------------------- */

const FIELD_BASE =
  "h-8 w-full rounded-md border bg-card px-2.5 text-sm text-foreground shadow-xs " +
  "transition-[border-color,box-shadow] duration-150 " +
  "placeholder:text-subtle-foreground " +
  "hover:border-border-strong " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/25 " +
  "disabled:cursor-not-allowed disabled:opacity-50 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20";

export function Input({ className, ...props }) {
  return <input className={cn(FIELD_BASE, "border-input", className)} {...props} />;
}

/**
 * Select — a hand-rolled listbox, not a native <select>.
 *
 * WHY: a native select's collapsed box is styleable, but its OPEN menu is
 * drawn by the OS on Windows and Linux and cannot be themed at all. In a dark
 * app, clicking the control pops a light system menu — the same class of
 * problem as the native title bar and scrollbars this change replaced.
 *
 * COST: everything a native select gives away free has to be rebuilt, and is,
 * below — keyboard navigation, typeahead, ARIA wiring, click-outside. What is
 * NOT rebuilt is the OS-level handling a native control gets on mobile and in
 * some assistive tech. This is a desktop Electron app, so that trade lands
 * well here; it would not on a public web form.
 *
 * The props contract is deliberately identical to the native version — `value`,
 * an `onChange` receiving an event-like `{ target: { value } }`, and <option>
 * children — so no call site changed, and reverting to a native <select> stays
 * a single-component edit.
 */
export function Select({
  className,
  children,
  value,
  onChange,
  id,
  disabled,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  ...props
}) {
  const reactId = useId();
  const listboxId = `${id || reactId}-listbox`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropUp, setDropUp] = useState(false);

  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const typeahead = useRef({ buffer: "", timer: null });

  // Read the <option> children into plain data, so callers can keep passing
  // the same JSX they passed the native element, including arrays from .map().
  const options = useMemo(() => {
    const flatten = (nodes) =>
      Children.toArray(nodes).flatMap((child) => {
        if (!isValidElement(child)) return [];
        if (child.type === "option") {
          const label = Children.toArray(child.props.children).join("");
          return [
            {
              value: String(child.props.value ?? label),
              label,
              disabled: Boolean(child.props.disabled),
            },
          ];
        }
        return flatten(child.props.children);
      });
    return flatten(children);
  }, [children]);

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  const commit = (index) => {
    const option = options[index];
    if (!option || option.disabled) return;
    setOpen(false);
    // Event-shaped so existing `(e) => ...e.target.value` handlers still work.
    if (option.value !== value) onChange?.({ target: { value: option.value } });
    triggerRef.current?.focus();
  };

  const openMenu = (startIndex = selectedIndex) => {
    if (disabled) return;
    // Flip upward when there is not enough room below, otherwise the menu is
    // clipped by the window edge and the last options cannot be reached.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setDropUp(window.innerHeight - rect.bottom < 240 && rect.top > 240);
    setActiveIndex(startIndex);
    setOpen(true);
  };

  // Close on any pointer press outside the control.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keep the active option in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const step = (delta) => {
    setActiveIndex((current) => {
      const count = options.length;
      let next = current;
      for (let i = 0; i < count; i++) {
        next = (next + delta + count) % count;
        if (!options[next]?.disabled) return next;
      }
      return current;
    });
  };

  // Jump to the first option starting with what was typed, the way a native
  // select does. The buffer clears after a pause, so "an" then "op" both work.
  const onTypeahead = (key) => {
    const state = typeahead.current;
    state.buffer += key.toLowerCase();
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      state.buffer = "";
    }, 600);

    const match = options.findIndex(
      (o) => !o.disabled && o.label.toLowerCase().startsWith(state.buffer),
    );
    if (match === -1) return;
    if (open) setActiveIndex(match);
    else commit(match);
  };

  const isPrintable = (event) =>
    event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;

  const onKeyDown = (event) => {
    if (disabled) return;

    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openMenu();
      } else if (isPrintable(event)) {
        event.preventDefault();
        onTypeahead(event.key);
      }
      return;
    }

    switch (event.key) {
      case "Escape":
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        commit(activeIndex);
        break;
      case "ArrowDown":
        event.preventDefault();
        step(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        step(-1);
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(options.findIndex((o) => !o.disabled));
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Tab":
        // Commit and move on, matching native behaviour.
        commit(activeIndex);
        break;
      default:
        if (isPrintable(event)) {
          event.preventDefault();
          onTypeahead(event.key);
        }
    }
  };

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        // ARIA 1.2 select-only combobox: a button owning a listbox, with the
        // active option pointed at by aria-activedescendant rather than focus.
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${activeIndex}` : undefined}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(FIELD_BASE, "border-input flex cursor-pointer items-center gap-2 text-left")}
        {...props}
      >
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? ""}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-subtle-foreground" aria-hidden="true" />
      </button>

      {open ? (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={ariaLabelledBy}
          tabIndex={-1}
          className={cn(
            "absolute z-50 max-h-60 w-full overflow-y-auto",
            // A step up in elevation and radius from the trigger, so it reads
            // as floating above the form rather than welded to it.
            "rounded-lg border border-border-strong bg-elevated p-1 shadow-md",
            dropUp ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={option.value}
                id={`${listboxId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                // mousedown, not click: click fires after the document-level
                // mousedown that closes the menu, so the selection is lost.
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(index);
                }}
                onMouseEnter={() => !option.disabled && setActiveIndex(index)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-foreground",
                  option.disabled && "cursor-not-allowed opacity-50",
                  isActive && !option.disabled && "bg-hover",
                )}
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0 text-accent",
                    isSelected ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function Label({ className, ...props }) {
  return (
    <label
      className={cn("block text-xs font-medium text-foreground", className)}
      {...props}
    />
  );
}

/**
 * Label + control + help/error, with the parts spaced by relationship rather
 * than uniformly: the label sits tight to its control (6px), help text sits
 * tighter still beneath it (4px), and the gap to the NEXT field is the one
 * that's large. That proximity is what makes a long form scannable.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  badge,
  children,
  className,
  // `false` when the control is a button rather than a real form element —
  // Select, for instance. A <label for> does not activate a button, so those
  // fields expose the text through aria-labelledby instead of pretending.
  labelable = true,
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  const LabelTag = labelable ? Label : "span";
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex flex-wrap items-center gap-2">
          <LabelTag
            id={`${htmlFor}-label`}
            htmlFor={labelable ? htmlFor : undefined}
            className={cn("mb-0", !labelable && "block text-xs font-medium text-foreground")}
          >
            {label}
          </LabelTag>
          {badge}
        </div>
      ) : null}
      {typeof children === "function" ? children({ describedBy }) : children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="max-w-[68ch] text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------- surfaces -------------------------------- */

/**
 * The standard content surface. `flush` drops the padding for panels whose
 * content manages its own edges (lists that scroll to the border, say).
 */
export function Panel({ className, flush = false, ...props }) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card shadow-xs",
        !flush && "p-4",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A panel header that sits ON the border rather than floating inside padding,
 * which visually anchors the title to the content it labels.
 */
export function PanelHeader({ title, meta, actions, className }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {meta ? <span className="text-xs text-muted-foreground">{meta}</span> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

/* ---------------------------------- badges ---------------------------------- */

const BADGE_TONES = {
  neutral: "bg-muted text-muted-foreground ring-border",
  outline: "bg-transparent text-muted-foreground ring-border",
  success: "bg-success-surface text-success ring-success/20",
  warning: "bg-warning-surface text-warning ring-warning/20",
  danger: "bg-danger-surface text-danger ring-danger/20",
  info: "bg-info-surface text-info ring-info/20",
  accent: "bg-accent-surface text-accent ring-accent/25",
  // Changelog categories. These five exist only for the classified-change list.
  feat: "bg-cat-feat-bg text-cat-feat ring-cat-feat/20",
  fix: "bg-cat-fix-bg text-cat-fix ring-cat-fix/20",
  breaking: "bg-cat-breaking-bg text-cat-breaking ring-cat-breaking/25",
  docs: "bg-cat-docs-bg text-cat-docs ring-cat-docs/20",
  chore: "bg-cat-chore-bg text-cat-chore ring-cat-chore/20",
};

export function Badge({ tone = "neutral", mono = false, children, className }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-semibold",
        // A 1px inset ring instead of a border keeps the badge's box the same
        // height whether or not it has one, so badges never shift a baseline.
        "ring-1 ring-inset",
        mono && "font-mono tracking-tight",
        BADGE_TONES[tone] ?? BADGE_TONES.neutral,
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------- toggle ---------------------------------- */

/**
 * Was broken: the old version put `<label htmlFor>` on a `<button>`, and labels
 * do not activate non-labelable elements — so clicking the toggle's own text
 * did nothing. The label is now a real click target wired to the same handler,
 * and the whole row is one focus stop.
 */
export function Toggle({
  checked,
  onChange,
  id,
  label,
  description,
  disabled,
  "aria-labelledby": ariaLabelledBy,
  "aria-label": ariaLabel,
}) {
  const descriptionId = description ? `${id}-description` : undefined;

  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={descriptionId}
      aria-labelledby={label ? undefined : ariaLabelledBy}
      aria-label={label ? undefined : ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-[18px] w-8 shrink-0 rounded-full border transition-colors duration-200",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked
          ? "border-accent bg-accent"
          : "border-border-strong bg-muted hover:border-subtle-foreground",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 block size-3 -translate-y-1/2 rounded-full bg-card shadow-sm",
          "transition-transform duration-200",
          checked ? "translate-x-[15px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );

  // Bare switch: the surrounding row supplies the label and description, so
  // rendering our own would duplicate them.
  if (!label) return control;

  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5">{control}</span>
      <div className="min-w-0">
        <span
          onClick={() => !disabled && onChange(!checked)}
          className={cn(
            "block text-sm font-medium text-foreground",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          )}
        >
          {label}
        </span>
        {description ? (
          <p id={descriptionId} className="mt-1 max-w-[68ch] text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------- feedback -------------------------------- */

const CALLOUT_TONES = {
  info: { wrap: "border-info/25 bg-info-surface", icon: "text-info" },
  warning: { wrap: "border-warning/30 bg-warning-surface", icon: "text-warning" },
  danger: { wrap: "border-danger/30 bg-danger-surface", icon: "text-danger" },
  success: { wrap: "border-success/25 bg-success-surface", icon: "text-success" },
};

/**
 * Inline message block. Takes its own icon so the caller can be specific
 * (a truncated range is not the same warning as a failed publish).
 */
export function Callout({ tone = "info", icon: IconComponent = Info, title, children, className, ...props }) {
  const styles = CALLOUT_TONES[tone] ?? CALLOUT_TONES.info;
  return (
    <div
      className={cn("flex gap-2.5 rounded-md border px-3 py-2.5", styles.wrap, className)}
      {...props}
    >
      <IconComponent className={cn("mt-px size-4 shrink-0", styles.icon)} aria-hidden="true" />
      <div className="min-w-0 space-y-1 text-xs text-foreground">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="max-w-[70ch] leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}

export function ErrorText({ children, className }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className={cn("flex items-start gap-1.5 text-xs break-words text-danger", className)}
    >
      <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Empty state. Deliberately NOT a centered sentence in the middle of a box:
 * it gets an icon, a title, and one line of guidance that says what to do
 * next, because "No commits found." on its own is a dead end.
 */
export function EmptyState({ icon: IconComponent, title, children, action, className, compact = false }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 px-6 py-8" : "gap-3 px-6 py-12",
        className,
      )}
    >
      {IconComponent ? (
        <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-subtle-foreground">
          <IconComponent className="size-4.5" aria-hidden="true" />
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children ? (
          <p className="mx-auto max-w-[52ch] text-xs leading-relaxed text-muted-foreground">
            {children}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

/** Row of shimmer bars used while a list loads, sized to the real rows. */
export function SkeletonRows({ rows = 4, className }) {
  return (
    <ul className={cn("animate-pulse divide-y divide-border", className)} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-start gap-2.5 px-4 py-2.5">
          <div className="mt-1 size-2 shrink-0 rounded-full bg-muted" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-2.5 rounded-sm bg-muted" style={{ width: `${72 - i * 9}%` }} />
            <div className="h-2 w-1/4 rounded-sm bg-muted" />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Inline "working…" line for regions that have no skeleton shape to mimic. */
export function LoadingLine({ children = "Loading…", className }) {
  return (
    <p
      role="status"
      className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
    >
      <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
      {children}
    </p>
  );
}
