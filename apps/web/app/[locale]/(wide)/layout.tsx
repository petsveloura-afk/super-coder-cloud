import type { ReactNode } from "react";

/** Full-width public pages (customer documents /q, published websites /s): no app chrome. */
export default function WidePublicLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-dvh pt-safe pb-safe">{children}</div>;
}
