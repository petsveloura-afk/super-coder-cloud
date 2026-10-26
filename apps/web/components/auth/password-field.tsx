"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/client";
import { passwordStrength } from "@/lib/auth-ui/password-strength";

/**
 * Wave 25 — a password input with a show/hide button and (optionally) a strength meter.
 * Same <input name="password"> as before, so every existing form action keeps working.
 */
export function PasswordInput({ meter = false, ...props }: InputHTMLAttributes<HTMLInputElement> & { meter?: boolean }) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  const [value, setValue] = useState("");
  const level = passwordStrength(value);
  const colors = ["bg-line", "bg-danger", "bg-warning", "bg-accent", "bg-success"];
  return (
    <div>
      <div className="relative">
        <Input {...props} type={shown ? "text" : "password"} dir="ltr" className="pe-11" onChange={(e) => { setValue(e.target.value); props.onChange?.(e); }} />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={t(shown ? "auth.hidePassword" : "auth.showPassword")}
          aria-pressed={shown}
          className="absolute inset-y-0 end-0 grid w-11 place-items-center text-muted hover:text-fg"
          tabIndex={0}
        >
          {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {meter && value ? (
        <div className="mt-1.5" data-testid="password-meter" aria-live="polite">
          <div className="flex gap-1">
            {[1, 2, 3, 4].map((i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i <= level ? colors[level] : "bg-line"}`} />
            ))}
          </div>
          <p className="mt-1 text-[11.5px] text-muted">{t(`auth.strength.${level}`)}</p>
        </div>
      ) : null}
    </div>
  );
}
