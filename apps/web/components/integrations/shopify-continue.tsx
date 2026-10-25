"use client";

import { useEffect } from "react";

/** Wave 24 — continues straight into Shopify OAuth (full navigation to the API route), with a button as a fallback. */
export function ShopifyContinue({ href, auto, label }: { href: string; auto: boolean; label: string }) {
  useEffect(() => {
    if (auto) window.location.replace(href);
  }, [auto, href]);
  return (
    <a href={href} className="mt-5 inline-flex h-10 items-center justify-center rounded-xl bg-accent-solid px-5 text-sm font-semibold text-white hover:bg-accent-solid-hover">
      {label}
    </a>
  );
}
