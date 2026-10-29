import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicEnv } from "@/lib/env";
import { emailConfigured, sendEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Prepaid (crypto) plans: expire after the period + grace, and e-mail a renewal reminder 3 days before. */
async function handle(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false }, { status: 503 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("sweep_prepaid_subscriptions");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const due = (data ?? []) as { organization_id: string; plan_key: string; period_end: string }[];
  let reminded = 0;
  if (emailConfigured()) {
    for (const d of due) {
      const { data: owner } = await admin.from("organization_members").select("user_id").eq("organization_id", d.organization_id).eq("role", "owner").limit(1).maybeSingle();
      if (!owner) continue;
      const { data: prof } = await admin.from("profiles").select("email").eq("id", owner.user_id).maybeSingle();
      if (!prof?.email) continue;
      const link = `${publicEnv.appUrl.replace(/\/$/, "")}/he/billing`;
      const date = new Date(d.period_end).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });
      await sendEmail({
        to: prof.email as string,
        subject: "תזכורת: המסלול שלכם מסתיים בקרוב",
        text: `המסלול ${d.plan_key} מסתיים ב-${date}. לחידוש: ${link}`,
        html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6">המסלול <b>${d.plan_key}</b> מסתיים ב-<b>${date}</b>.<br><a href="${link}">לחידוש המסלול בלחיצה</a></div>`,
      });
      reminded++;
    }
  }
  return NextResponse.json({ ok: true, due: due.length, reminded });
}

export const GET = handle;
export const POST = handle;
