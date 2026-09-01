import { AlertCircle, Info, Loader2 } from "lucide-react";
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

export function Select({ className, children, ...props }) {
  return (
    <select className={cn(FIELD_BASE, "border-input cursor-pointer pr-7", className)} {...props}>
      {children}
    </select>
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
export function Field({ label, htmlFor, hint, error, badge, children, className }) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={htmlFor} className="mb-0">
            {label}
          </Label>
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
