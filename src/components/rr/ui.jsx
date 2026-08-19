import { cn } from "@/lib/utils";

export function Button({ variant = "default", size = "md", className, ...props }) {
  const variants = {
    default:
      "bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 border border-transparent",
    secondary:
      "bg-card text-foreground border border-border hover:bg-accent disabled:opacity-50",
    ghost: "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
    danger:
      "bg-transparent text-destructive border border-border hover:bg-destructive/10 disabled:opacity-50",
  };
  const sizes = {
    sm: "h-7 px-2 text-xs",
    md: "h-8 px-3 text-[13px]",
    lg: "h-9 px-4 text-[13px]",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        "h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/70 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }) {
  return (
    <select
      className={cn(
        "h-8 rounded-md border border-input bg-card px-2 text-[13px] text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Label({ className, ...props }) {
  return (
    <label
      className={cn("mb-1 block text-[12px] font-medium text-foreground", className)}
      {...props}
    />
  );
}

export function Panel({ className, ...props }) {
  return (
    <section
      className={cn("rounded-lg border border-border bg-card p-3.5", className)}
      {...props}
    />
  );
}

export function Badge({ tone = "muted", children, className }) {
  const tones = {
    muted: "bg-muted text-muted-foreground",
    ok: "bg-cat-feat-bg text-cat-feat",
    warn: "bg-cat-breaking-bg text-cat-breaking",
    feat: "bg-cat-feat-bg text-cat-feat",
    fix: "bg-cat-fix-bg text-cat-fix",
    breaking: "bg-cat-breaking-bg text-cat-breaking",
    docs: "bg-cat-docs-bg text-cat-docs",
    chore: "bg-cat-chore-bg text-cat-chore",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold",
        tones[tone] ?? tones.muted,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Toggle({ checked, onChange, id, label, description }) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "mt-0.5 h-5 w-9 shrink-0 rounded-full border border-border transition-colors",
          checked ? "bg-cat-feat" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "block h-3.5 w-3.5 rounded-full bg-card shadow transition-transform",
            checked ? "translate-x-[18px]" : "translate-x-[3px]",
          )}
        />
      </button>
      <div className="min-w-0">
        <label htmlFor={id} className="cursor-pointer text-[13px] text-foreground">
          {label}
        </label>
        {description ? (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ErrorText({ children }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-[12px] break-words text-destructive">
      {children}
    </p>
  );
}
