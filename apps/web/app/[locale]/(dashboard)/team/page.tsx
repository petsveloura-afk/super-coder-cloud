import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { assignableRoles, isOrgRole, type OrgRole } from "@scc/shared/permissions";
import { Badge, Card, CardHeader, Ltr, PageHeader } from "@/components/ui/primitives";
import { InviteDialog, RemoveMemberButton, RevokeInviteButton, RoleSelect } from "@/components/team/team-client";
import { getOrgContext } from "@/lib/auth";
import { getT, resolveLocale } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { initials } from "@/lib/utils";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { t } = await getT(await resolveLocale(params));
  return { title: t("team.title") };
}

const RANK: Record<OrgRole, number> = { agency_owner: 100, owner: 90, admin: 80, manager: 60, marketing: 40, sales: 40, support: 40, analyst: 30, client: 10, read_only: 10 };

export default async function TeamPage({ params }: { params: Promise<{ locale: string }> }) {
  const locale = await resolveLocale(params);
  const ctx = await getOrgContext(locale);
  if (!ctx.can("members.read")) redirect(`/${locale}/overview`);
  const { t } = await getT(locale);
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", ctx.org.id)
    .order("created_at", { ascending: true });
  const ids = (members ?? []).map((m) => m.user_id as string);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [] as { id: string; full_name: string; email: string }[] };
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));

  const canInvite = ctx.can("members.invite");
  const canManage = ctx.can("members.manage");
  const { data: invites } = canInvite
    ? await supabase
        .from("invitations")
        .select("id, email, role, expires_at")
        .eq("organization_id", ctx.org.id)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
    : { data: [] as { id: string; email: string; role: string; expires_at: string }[] };

  const grantable = assignableRoles(ctx.role);

  return (
    <>
      <PageHeader title={t("team.title")} description={t("team.subtitle")} actions={canInvite ? <InviteDialog roles={grantable} /> : null} />

      <Card>
        <CardHeader title={t("team.members")} description={String(members?.length ?? 0)} />
        <ul className="divide-y divide-line">
          {(members ?? []).map((m) => {
            const p = byId.get(m.user_id as string);
            const role = isOrgRole(m.role) ? m.role : "read_only";
            const isSelf = m.user_id === ctx.userId;
            const editable = canManage && !isSelf && RANK[role] <= RANK[ctx.role];
            return (
              <li key={m.user_id as string} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-[13px] font-bold text-accent">
                    {initials(p?.full_name || p?.email || "?")}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate font-medium">
                      {p?.full_name || "—"}
                      {isSelf ? <Badge tone="teal">{t("team.you")}</Badge> : null}
                    </div>
                    <Ltr className="block truncate text-[13px] text-muted">{p?.email ?? ""}</Ltr>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {editable ? <RoleSelect userId={m.user_id as string} role={role} roles={grantable} /> : <Badge tone="accent">{t(`team.roles.${role}`)}</Badge>}
                  {editable ? <RemoveMemberButton userId={m.user_id as string} /> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      {canInvite && (invites?.length ?? 0) > 0 ? (
        <Card className="mt-4">
          <CardHeader title={t("team.pendingInvites")} />
          <ul className="divide-y divide-line">
            {(invites ?? []).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Ltr className="min-w-0 flex-1 truncate text-sm">{i.email}</Ltr>
                <Badge>{t(`team.roles.${i.role}`)}</Badge>
                <span className="text-[12px] text-subtle">{t("team.expires", { date: formatDate(locale, i.expires_at) })}</span>
                <RevokeInviteButton id={i.id} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
