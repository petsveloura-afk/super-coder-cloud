import type { ReactNode } from "react";
import { PERMISSIONS } from "@scc/shared/permissions";
import { AppShell } from "@/components/layout/app-shell";
import { getOrgContext } from "@/lib/auth";
import { resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", ctx.org.id)
    .is("read_at", null);

  return (
    <AppShell
      user={{ name: ctx.profile?.full_name ?? "", email: ctx.email }}
      org={{ id: ctx.org.id, name: ctx.org.name, isDemo: ctx.org.is_demo }}
      role={ctx.role}
      permissions={PERMISSIONS.filter((p) => ctx.can(p))}
      workspaces={ctx.memberships.map((m) => ({ id: m.organization_id, name: m.organizations?.name ?? "", role: m.role }))}
      unreadNotifications={count ?? 0}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      {children}
    </AppShell>
  );
}
