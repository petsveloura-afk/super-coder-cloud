import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------- Button */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "btn-brand bg-accent-solid text-accent-fg hover:bg-accent-solid-hover hover:brightness-110 shadow-[0_8px_22px_-10px_var(--brand)]",
  secondary: "bg-surface text-fg border border-line hover:bg-surface-hover",
  outline: "border border-line-strong text-fg hover:bg-surface-hover",
  ghost: "text-muted hover:text-fg hover:bg-surface-hover",
  danger: "bg-danger-soft text-danger border border-danger/30 hover:bg-danger hover:text-white",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
  icon: "h-10 w-10 justify-center",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "btn-press inline-flex select-none items-center rounded-xl font-medium transition-[color,background-color,border-color,filter,transform,box-shadow] duration-150 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}

/* ----------------------------------------------------------------- Inputs */
const fieldBase =
  "w-full rounded-xl border border-line bg-elevated px-3.5 text-[15px] text-fg placeholder:text-subtle transition-[border-color,box-shadow] hover:border-line-strong focus:border-accent focus:outline-none focus:ring-4 focus:ring-ring/40 aria-[invalid=true]:border-danger";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(fieldBase, "h-11", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-2.5", className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn(fieldBase, "h-11 cursor-pointer pe-8", className)} {...props}>
      {children}
    </select>
  );
});

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-muted">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- Card */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card-premium rounded-[var(--radius-card)] border border-line bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
        {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ Badge */
type Tone = "neutral" | "accent" | "teal" | "gold" | "success" | "warning" | "danger";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-hover text-muted border-line",
  accent: "bg-accent-soft text-accent border-accent/25",
  teal: "bg-teal-soft text-teal border-teal/25",
  gold: "bg-gold-soft text-gold border-gold/30",
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-danger-soft text-danger border-danger/25",
};
export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[12px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}

/* --------------------------------------------------------- Misc helpers */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("ltr-iso", className)}>
      {children}
    </bdi>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-4", className)} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? (
        <div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-line bg-elevated text-accent">{icon}</div>
      ) : null}
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {body ? <p className="mt-1 max-w-sm text-sm text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="page-head page-enter mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="title-bar text-[22px] font-bold tracking-tight text-fg sm:text-[26px]">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
