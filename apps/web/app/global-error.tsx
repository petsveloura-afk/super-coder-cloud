"use client";

import { useEffect } from "react";

/** Last-resort boundary (root layout failed). Must render its own <html>/<body> and cannot rely on providers or i18n. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    // report the crash once (grouped in Mission Control)
    void fetch("/api/errors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `[global] ${error.message || "error"}`.slice(0, 1000), route: window.location.pathname, digest: error.digest }), keepalive: true }).catch(() => undefined);
  }, [error]);
  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", display: "grid", minHeight: "100dvh", placeItems: "center", textAlign: "center", padding: 24 }}>
        <div role="alert">
          <h1 style={{ fontSize: 20 }}>משהו השתבש · Something went wrong · حدث خطأ</h1>
          {error.digest ? <p dir="ltr" style={{ fontSize: 12, opacity: 0.6 }}>ref: {error.digest}</p> : null}
          <button type="button" onClick={reset} style={{ marginTop: 16, height: 40, padding: "0 16px", borderRadius: 12, border: 0, background: "#4f46e5", color: "#fff", cursor: "pointer" }}>
            נסו שוב · Retry · أعد المحاولة
          </button>
        </div>
      </body>
    </html>
  );
}
