"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createOrganizationSchema, fieldErrors } from "@scc/shared/validators";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_ORG_COOKIE, getUser } from "@/lib/auth";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { formValues, type ActionState } from "@/lib/action-state";

const cookieOpts = { path: "/", httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 180 };

function loc(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

export async function createOrganizationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = loc(fd);
  if (!(await getUser())) redirect(`/${locale}/login`);
  const values = formValues(fd, ["name", "slug", "currency"]);
  const parsed = createOrganizationSchema.safeParse({
    name: fd.get("name"),
    slug: fd.get("slug"),
    locale,
    currency: fd.get("currency") || "ILS",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_organization", {
    p_name: parsed.data.name,
    p_slug: parsed.data.slug,
    p_locale: parsed.data.locale,
    p_timezone: parsed.data.timezone,
    p_currency: parsed.data.currency,
  });
  if (error) {
    if (error.code === "23505") return { fieldErrors: { slug: "onboarding.slugTaken" }, values };
    if (error.code === "54000") return { error: "onboarding.limitReached", values };
    return { error: "errors.generic", values };
  }
  (await cookies()).set(ACTIVE_ORG_COOKIE, String(data), cookieOpts);
  redirect(`/${locale}/overview`);
}

export async function acceptInvitationAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = loc(fd);
  const token = z.string().trim().min(20).max(200).safeParse(fd.get("token"));
  if (!token.success) return { fieldErrors: { token: "onboarding.inviteInvalid" } };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token.data });
  if (error || !data) return { fieldErrors: { token: "onboarding.inviteInvalid" } };
  (await cookies()).set(ACTIVE_ORG_COOKIE, String(data), cookieOpts);
  redirect(`/${locale}/overview`);
}

/** Workspace switcher. Membership is re-validated on every request in getOrgContext. */
export async function switchOrganizationAction(fd: FormData) {
  const locale = loc(fd);
  const orgId = z.uuid().safeParse(fd.get("orgId"));
  if (orgId.success) (await cookies()).set(ACTIVE_ORG_COOKIE, orgId.data, cookieOpts);
  redirect(`/${locale}/overview`);
}
