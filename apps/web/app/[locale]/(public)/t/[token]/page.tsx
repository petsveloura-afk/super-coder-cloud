import { notFound } from "next/navigation";
import { TicketThread, type PublicTicket } from "@/components/public/support-portal";
import { createAnonClient } from "@/lib/supabase/anon";
import { resolveLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false } };

export default async function PublicTicketPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  await resolveLocale(params);
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/.test(token)) notFound();
  const { data } = await createAnonClient().rpc("get_public_ticket", { p_token: token });
  if (!data) notFound();
  return <TicketThread token={token} ticket={data as PublicTicket} />;
}
