import { redirect } from "next/navigation";
import { Card } from "@/components/ui/primitives";
import { isSupabaseConfigured, missingPublicEnv } from "@/lib/env";
import { resolveLocale } from "@/lib/i18n/server";

/**
 * First-run screen shown when required configuration is missing, instead of
 * crashing. Intentionally bilingual & technical: it is read by the installer.
 */
export default async function SetupPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  if (isSupabaseConfigured()) redirect(`/${locale}/login`);
  const missing = missingPublicEnv();
  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-xl font-bold">נדרשת הגדרה ראשונית · Configuration required</h1>
      <p className="mt-2 text-sm text-muted">
        הגדירו את משתני הסביבה הבאים ב-<code dir="ltr">apps/web/.env.local</code> (או ב-Vercel) והפעילו מחדש.
      </p>
      <ul className="mt-4 space-y-2" dir="ltr">
        {missing.map((m) => (
          <li key={m} className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 font-mono text-[13px] text-warning">
            {m}
          </li>
        ))}
      </ul>
      <p className="mt-4 text-[13px] text-subtle" dir="ltr">
        See docs/INSTALLATION.md and docs/ENVIRONMENT.md
      </p>
    </Card>
  );
}
