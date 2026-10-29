import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Super Coder Cloud",
    short_name: "Super Coder",
    description: "מערכת ההפעלה של העסק שלך — CRM, אוטומציה ו-AI",
    lang: "he",
    dir: "rtl",
    start_url: "/he/overview",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#080D19",
    theme_color: "#080D19",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    // wave 48 — app-like extras: stable id, window controls on desktop, re-use the open window, long-press shortcuts
    id: "/he/overview",
    display_override: ["window-controls-overlay", "standalone", "minimal-ui"],
    launch_handler: { client_mode: ["navigate-existing", "auto"] },
    prefer_related_applications: false,
    shortcuts: [
      { name: "תיבת הודעות", short_name: "הודעות", url: "/he/inbox", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "אנשי קשר", short_name: "אנשי קשר", url: "/he/crm", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "רשתות וביקורות", short_name: "סושיאל", url: "/he/social", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
      { name: "משימות", short_name: "משימות", url: "/he/tasks", icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }] },
    ],
  };
}
