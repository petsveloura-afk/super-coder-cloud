import type { Metadata } from "next";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { publicEnv } from "@/lib/env";
import { openApiDocument } from "@/lib/openapi";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("apiDocs.title") };
}

const METHOD_TONE: Record<string, string> = { get: "bg-teal-soft text-teal", post: "bg-accent-soft text-accent", patch: "bg-gold-soft text-gold", delete: "bg-danger-soft text-danger" };

/** Spec J1 — the API reference, rendered from the same OpenAPI document (no external script, CSP-safe). */
export default async function ApiDocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const { t } = await getT(locale);
  const doc = openApiDocument(publicEnv.appUrl);
  const base = doc.servers[0]!.url;
  const ops = Object.entries(doc.paths).flatMap(([path, item]) =>
    Object.entries(item as Record<string, unknown>)
      .filter(([m]) => ["get", "post", "patch", "delete", "put"].includes(m))
      .map(([m, op]) => ({ path, method: m, op: op as { summary?: string; description?: string; tags?: string[]; parameters?: { name: string; in: string; required?: boolean }[] } })),
  );
  const tags = doc.tags.map((x) => x.name);
  return (
    <main className="mx-auto max-w-4xl px-4 py-10" dir="ltr" lang="en">
      <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-gold">Super Coder Cloud</p>
      <h1 className="mt-2 text-3xl font-bold">{doc.info.title}</h1>
      <p className="mt-2 text-muted">{doc.info.description}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-[13px]">
        <code className="rounded-lg bg-elevated px-2.5 py-1.5">{base}</code>
        <a href="/api/public/v1/openapi.json" className="rounded-lg border border-line px-2.5 py-1.5 font-medium text-accent hover:bg-surface-hover">
          openapi.json
        </a>
        <a href={`/${locale}/integrations`} className="rounded-lg border border-line px-2.5 py-1.5 hover:bg-surface-hover" dir="auto">
          {t("apiDocs.getKey")}
        </a>
      </div>
      <pre className="mt-5 overflow-x-auto rounded-2xl bg-[#0b1020] p-4 text-[12.5px] text-[#e2e8f0]">{`curl ${base}/contacts?limit=10 \\\n  -H "Authorization: Bearer scc_live_…"`}</pre>
      {tags.map((tag) => (
        <section key={tag} className="mt-8">
          <h2 className="text-xl font-semibold">{tag}</h2>
          <ul className="mt-3 space-y-2">
            {ops
              .filter((o) => o.op.tags?.includes(tag))
              .map((o) => (
                <li key={`${o.method} ${o.path}`} className="rounded-2xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${METHOD_TONE[o.method] ?? ""}`}>{o.method}</span>
                    <code className="font-semibold">{o.path}</code>
                    <span className="text-[13px] text-muted">{o.op.summary}</span>
                  </div>
                  {o.op.description ? <p className="mt-1.5 text-[12.5px] text-subtle">{o.op.description}</p> : null}
                  {o.op.parameters?.length ? (
                    <p className="mt-1.5 text-[12px] text-subtle">
                      {o.op.parameters.map((p) => `${p.name}${p.required ? "*" : ""} (${p.in})`).join(" · ")}
                    </p>
                  ) : null}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
