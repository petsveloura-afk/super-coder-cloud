"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eraser, PenLine, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input } from "@/components/ui/primitives";
import { signPublicQuote } from "@/app/[locale]/(public)/actions";

/**
 * Wave 15 — the customer signs a quote with a finger (phone) or mouse.
 * Canvas with pointer events (mouse / touch / pen), crisp on high-DPI screens,
 * "clear", typed full name and an explicit "I agree" checkbox. The PNG is sent to
 * the server, stored with the document and a SHA-256 of its content.
 */
export function ContractSign({ token }: { token: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [inked, setInked] = useState(false);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const resize = () => {
      const r = c.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.4;
      ctx.strokeStyle = "#0f172a";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, r.width, r.height);
      setInked(false);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inked) setInked(true);
  };
  const up = () => {
    drawing.current = false;
    last.current = null;
  };
  const clear = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const r = c.getBoundingClientRect();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, r.width, r.height);
    setInked(false);
  };

  return (
    <form
      className="space-y-4 rounded-2xl border border-line p-4 sm:p-5"
      data-testid="contract-sign"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (!name.trim()) return setError("finance.nameRequired");
        if (!inked) return setError("contract.sign.required");
        if (!agree) return setError("contract.mustAgree");
        const signature = canvas.current?.toDataURL("image/png") ?? "";
        start(async () => {
          const r = await signPublicQuote({ token, name, signature, agree });
          if (!r.ok) setError(r.error ?? "errors.generic");
          else router.refresh();
        });
      }}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <PenLine className="h-4 w-4 text-accent" /> {t("contract.signTitle")}
      </h2>
      <Field label={t("finance.acceptName")} htmlFor="sig-name">
        <Input id="sig-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted">{t("contract.drawHere")}</span>
          <Button variant="ghost" size="sm" onClick={clear}>
            <Eraser className="h-4 w-4" /> {t("contract.clear")}
          </Button>
        </div>
        <canvas
          ref={canvas}
          className="block h-40 w-full touch-none rounded-xl border border-dashed border-line-strong bg-white"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          aria-label={t("contract.drawHere")}
          role="img"
          data-testid="signature-pad"
        />
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px]">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]" data-testid="sign-agree" />
        <span>{t("contract.agree")}</span>
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t(error)}
        </p>
      ) : null}
      <Button type="submit" size="lg" loading={pending} className="w-full justify-center sm:w-auto">
        <ShieldCheck className="h-4 w-4" /> {t("contract.signAndAccept")}
      </Button>
      <p className="text-[11.5px] leading-relaxed text-subtle">{t("contract.legal")}</p>
    </form>
  );
}
