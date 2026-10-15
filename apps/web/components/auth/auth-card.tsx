import type { ReactNode } from "react";
import { Card } from "@/components/ui/primitives";

export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <Card className="glass p-6 sm:p-8">
        <h1 className="text-2xl font-bold tracking-tight text-fg">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </Card>
      {footer ? <p className="mt-5 text-center text-sm text-muted">{footer}</p> : null}
    </>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="my-5 flex items-center gap-3 text-[12px] text-subtle">
      <span className="h-px flex-1 bg-line" />
      {label}
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
