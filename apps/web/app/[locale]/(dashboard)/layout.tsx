import type { ReactNode } from "react";
import { PERMISSIONS } from "@scc/shared/permissions";
import { AppShell } from "@/components/layout/app-shell";
import { GuideHelpButton } from "@/components/guide/help-button";
import { getOrgContext } from "@/lib/auth";
import { resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  const supabase = await createClient();
  // wave 20: the bell and the inbox tab both show a live count (one round trip)
  const [{ count }, { count: inboxCount }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).is("read_at", null),
    ctx.can("inbox.read")
      ? supabase.from("conversations").select("id", { count: "exact", head: true }).eq("organization_id", ctx.org.id).eq("status", "open").gt("unread_count", 0)
      : Promise.resolve({ count: 0 }),
  ]);

  return (
    <AppShell
      user={{ name: ctx.profile?.full_name ?? "", email: ctx.email, avatarUrl: ctx.profile?.avatar_url ?? null }}
      org={{ id: ctx.org.id, name: ctx.org.name, isDemo: ctx.org.is_demo }}
      role={ctx.role}
      permissions={PERMISSIONS.filter((p) => ctx.can(p))}
      workspaces={ctx.memberships.map((m) => ({ id: m.organization_id, name: m.organizations?.name ?? "", role: m.role }))}
      unreadNotifications={count ?? 0}
      unreadInbox={inboxCount ?? 0}
      isPlatformAdmin={ctx.isPlatformAdmin}
    >
      {children}
      {/* wave 23: help for the screen you are on → the matching step of the user guide */}
      <GuideHelpButton />
    </AppShell>
  );
}
