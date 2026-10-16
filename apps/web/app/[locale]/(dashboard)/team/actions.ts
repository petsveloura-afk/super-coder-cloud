"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ORG_ROLES, assignableRoles } from "@scc/shared/permissions";
import { fieldErrors, uuidSchema } from "@scc/shared/validators";
import { getOrgContext } from "@/lib/auth";
import { publicEnv } from "@/lib/env";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { createClient } from "@/lib/supabase/server";
import { dbErrorKey, formValues, type ActionState } from "@/lib/action-state";
import { invitationEmail, sendEmail } from "@/lib/email/send";
import { getT } from "@/lib/i18n/server";

function loc(fd: FormData): Locale {
  const l = fd.get("locale");
  return isLocale(l) ? l : "he";
}

const inviteSchema = z.object({
  email: z.email({ message: "validation.email" }).trim().toLowerCase(),
  role: z.enum(ORG_ROLES),
});

export async function createInvitationAction(
  _prev: ActionState<{ link: string; emailed?: boolean }>,
  fd: FormData,
): Promise<ActionState<{ link: string; emailed?: boolean }>> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const values = formValues(fd, ["email", "role"]);
  if (!ctx.can("members.invite")) return { error: "errors.forbidden", values };
  const parsed = inviteSchema.safeParse({ email: fd.get("email"), role: fd.get("role") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  if (!assignableRoles(ctx.role).includes(parsed.data.role)) return { error: "errors.forbidden", values };

  // Raw token is shown ONCE; only its SHA-256 hash is stored.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .insert({ organization_id: ctx.org.id, email: parsed.data.email, role: parsed.data.role, token_hash: tokenHash, invited_by: ctx.userId })
    .select("id")
    .single();
  if (error) return { error: dbErrorKey(error), values };

  await supabase.rpc("log_event", {
    p_org: ctx.org.id,
    p_action: "invitation.created",
    p_entity_type: "invitation",
    p_entity_id: data.id,
    p_metadata: { role: parsed.data.role },
  });
  revalidatePath(`/${locale}/team`);
  const link = `${publicEnv.appUrl}/${locale}/onboarding?invite=${token}`;

  // Send the invitation by email when a provider is configured (never from demo workspaces).
  let emailed = false;
  if (!ctx.org.is_demo) {
    const { t } = await getT(locale);
    const mail = invitationEmail({
      locale,
      orgName: ctx.org.name,
      inviterName: ctx.profile?.full_name || ctx.email,
      roleLabel: t(`team.roles.${parsed.data.role}`),
      link,
    });
    emailed = (await sendEmail({ to: parsed.data.email, ...mail })).sent;
  }
  return { ok: true, message: emailed ? "team.inviteEmailed" : "team.inviteCreated", data: { link, emailed } };
}

export async function revokeInvitationAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const id = uuidSchema.safeParse(fd.get("id"));
  if (!id.success || !ctx.can("members.invite")) return;
  const supabase = await createClient();
  await supabase.from("invitations").delete().eq("id", id.data).eq("organization_id", ctx.org.id);
  await supabase.rpc("log_event", { p_org: ctx.org.id, p_action: "invitation.revoked", p_entity_type: "invitation", p_entity_id: id.data });
  revalidatePath(`/${locale}/team`);
}

export async function changeRoleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const userId = uuidSchema.safeParse(fd.get("userId"));
  const role = z.enum(ORG_ROLES).safeParse(fd.get("role"));
  if (!userId.success || !role.success) return { error: "validation.invalidId" };
  if (!ctx.can("members.manage") || userId.data === ctx.userId) return { error: "errors.forbidden" };
  const supabase = await createClient();
  // DB trigger enforces: no escalation above own rank, last owner preserved.
  const { data, error } = await supabase
    .from("organization_members")
    .update({ role: role.data })
    .eq("organization_id", ctx.org.id)
    .eq("user_id", userId.data)
    .select("user_id");
  if (error || !data?.length) return { error: error ? dbErrorKey(error) : "errors.forbidden" };
  revalidatePath(`/${locale}/team`);
  return { ok: true, message: "common.saved" };
}

export async function removeMemberAction(fd: FormData) {
  const locale = loc(fd);
  const ctx = await getOrgContext(locale);
  const userId = uuidSchema.safeParse(fd.get("userId"));
  if (!userId.success || !ctx.can("members.manage") || userId.data === ctx.userId) return;
  const supabase = await createClient();
  await supabase.from("organization_members").delete().eq("organization_id", ctx.org.id).eq("user_id", userId.data);
  revalidatePath(`/${locale}/team`);
}
