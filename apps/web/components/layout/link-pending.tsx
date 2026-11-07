"use client";

import { useLinkStatus } from "next/link";

/**
 * Speed feel (additive): the moment a menu link is tapped it shows a small pulse until the next page arrives — the tap is
 * acknowledged at once instead of looking frozen while the server prepares the page. Must be rendered INSIDE a <Link>.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`link-pending ${pending ? "is-pending" : ""} ${className ?? ""}`.trim()} />;
}
