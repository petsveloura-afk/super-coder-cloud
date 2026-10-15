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
  };
}
