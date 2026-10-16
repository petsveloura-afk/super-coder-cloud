import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getOrgContext } from "@/lib/auth";
import { isLocale } from "@/lib/i18n/config";
import { exchangeCode, type MailOAuthProvider } from "@/lib/channels/oauth-mail";
import { detectMailServers, presetFor } from "@/lib/channels/email-core";
import { verifyMailbox } from "@/lib/channels/email";
import { saveMailbox } from "@/lib/channels/mailbox-save";
import { encryptionReady } from "@/lib/channels/secrets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** OAuth redirect target: stores the mailbox (refresh token, encrypted) and returns to Integrations. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const cookie = request.cookies.get("scc_oauth_mail")?.value ?? "";
  const [state = "", cp = "", cl = "", orgId = ""] = cookie.split(".");
  const locale = isLocale(cl) ? cl : "he";
  const back = new URL(`/${locale}/integrations`, request.url);
  const done = (status: string, detail?: string) => {
    back.searchParams.set("mail", status);
    if (detail) back.searchParams.set("detail", detail.slice(0, 160));
    const res = NextResponse.redirect(back);
    res.cookies.set("scc_oauth_mail", "", { path: "/api/oauth", maxAge: 0 });
    return res;
  };
  if ((provider !== "google" && provider !== "microsoft") || cp !== provider) return done("failed", "provider");
  const given = request.nextUrl.searchParams.get("state") ?? "";
  if (!state || given.length !== state.length || !timingSafeEqual(Buffer.from(given), Buffer.from(state))) return done("failed", "state");
  if (request.nextUrl.searchParams.get("error")) return done("cancelled");
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return done("failed", "code");
  const ctx = await getOrgContext(locale);
  if (!ctx.can("integrations.manage") || ctx.org.id !== orgId) return done("forbidden");
  if (!encryptionReady()) return done("failed", "encryption_key_missing");

  const p = provider as MailOAuthProvider;
  const tok = await exchangeCode(p, code);
  if (!tok.ok || !tok.refreshToken || !tok.email) return done("failed", tok.error ?? "no_email");
  const servers = p === "google" ? presetFor("gmail")! : presetFor("outlook")!;
  const auto = detectMailServers(tok.email);
  const cfg = {
    address: tok.email,
    display_name: ctx.org.name,
    auth: p,
    imap_host: servers.imap_host || auto.imap_host,
    imap_port: servers.imap_port,
    smtp_host: servers.smtp_host,
    smtp_port: p === "google" ? 465 : 587,
  };
  const check = await verifyMailbox(cfg, { refresh_token: tok.refreshToken });
  if (!check.ok) return done("failed", `${check.step}: ${check.error ?? ""}`);
  const saved = await saveMailbox({ orgId: ctx.org.id, userId: ctx.userId, config: cfg, secrets: { refresh_token: tok.refreshToken }, uidValidity: check.uid_validity, lastUid: check.last_uid });
  return saved.ok ? done("connected") : done("failed", "save");
}
