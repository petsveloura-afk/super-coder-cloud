import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={cn("h-8 w-8", className)}>
      <rect width="512" height="512" rx="116" fill="#080D19" />
      <rect x="24" y="24" width="464" height="464" rx="100" fill="none" stroke="#C9A66B" strokeOpacity=".4" strokeWidth="6" />
      <path d="M180 170 L104 256 L180 342" fill="none" stroke="#477BFF" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M332 170 L408 256 L332 342" fill="none" stroke="#00D9C5" strokeWidth="40" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M286 140 L226 372" stroke="#F8FAFC" strokeWidth="36" strokeLinecap="round" />
    </svg>
  );
}

export function BrandLockup({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark />
      {!compact ? (
        <div className="leading-tight" dir="ltr">
          <div className="text-[15px] font-bold tracking-tight text-fg">Super Coder</div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-gold">Cloud</div>
        </div>
      ) : null}
    </div>
  );
}
