import type { Metadata } from "next";
import { SiteLiveFrame } from "@/components/websites/site-live-frame";

export const metadata: Metadata = { title: "Preview", robots: { index: false, follow: false } };

/**
 * Wave 33 — the live preview inside the site editor. It renders whatever draft the editor
 * sends with postMessage (same origin only), so unsaved edits — including the agent's — are
 * visible instantly. Members-only (not in the public paths of the proxy); it never reads or
 * writes the database.
 */
export default function SiteLivePage() {
  return <SiteLiveFrame />;
}
