import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isOrgRole, roleHasPermission, type OrgRole, type Permission } from "@scc/shared/permissions";
import type { MembershipWithOrg } from "@scc/database";
import { createClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n/config";

export const ACTIVE_ORG_COOKIE = "scc_org";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  locale: Locale;
  default_organization_id: string | null;
}

export interface OrgContext {
  userId: string;
  email: string;
  profile: Profile | null;
  org: NonNullable<MembershipWithOrg["organizations"]> & { id: string };
  role: OrgRole;
  memberships: MembershipWithOrg[];
  isPlatformAdmin: boolean;
  can: (p: Permission) => boolean;
}

/** Validated user (round-trips to Supabase Auth; never trusts a decoded cookie alone). */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireUser(locale: Locale) {
  const user = await getUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

export const getMemberships = cache(async (userId: string): Promise<MembershipWithOrg[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("organization_id, user_id, role, organizations(id, name, slug, is_demo, currency, locale)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as MembershipWithOrg[];
});

/**
 * Resolves the active organization for this request. The cookie is only a
 * HINT — it is honoured solely if the user is a member of that org (the
 * membership list itself is RLS-filtered to the current user).
 */
export const getOrgContext = cache(async (locale: Locale): Promise<OrgContext> => {
  const user = await requireUser(locale);
  const supabase = await createClient();
  const [memberships, profileRes, adminRes] = await Promise.all([
    getMemberships(user.id),
    supabase.from("profiles").select("id, email, full_name, locale, default_organization_id").eq("id", user.id).maybeSingle(),
    supabase.rpc("is_platform_admin"),
  ]);
  const profile = (profileRes.data as Profile | null) ?? null;
  const valid = memberships.filter((m) => m.organizations && isOrgRole(m.role));
  if (valid.length === 0) redirect(`/${locale}/onboarding`);

  const hint = (await cookies()).get(ACTIVE_ORG_COOKIE)?.value;
  const active =
    valid.find((m) => m.organization_id === hint) ??
    valid.find((m) => m.organization_id === profile?.default_organization_id) ??
    valid[0]!;

  const role = active.role;
  return {
    userId: user.id,
    email: user.email ?? "",
    profile,
    org: active.organizations!,
    role,
    memberships: valid,
    isPlatformAdmin: adminRes.data === true,
    can: (p: Permission) => roleHasPermission(role, p),
  };
});

export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN";
}

/** Server-side guard for actions/route handlers (RLS remains the final gate). */
export function assertCan(ctx: OrgContext, permission: Permission) {
  if (!ctx.can(permission)) throw new ForbiddenError(permission);
}
