import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BookingWidget, type PublicBooking } from "@/components/public/booking-widget";
import { createAnonClient } from "@/lib/supabase/anon";
import { resolveLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";
type Params = Promise<{ locale: string; slug: string }>;

async function load(slug: string) {
  if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(slug)) return null;
  // wave 16: v2 adds busy times from the host's connected calendar
  const anon = createAnonClient();
  const v2 = await anon.rpc("get_public_booking_v2", { p_slug: slug });
  if (!v2.error) return v2.data as PublicBooking | null;
  const { data } = await anon.rpc("get_public_booking", { p_slug: slug });
  return data as PublicBooking | null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const b = await load(slug);
  return { title: b ? `${b.name} · ${b.org}` : "404", robots: { index: false } };
}

export default async function BookingPage({ params }: { params: Params }) {
  await resolveLocale(params);
  const { slug } = await params;
  const b = await load(slug);
  if (!b) notFound();
  return <BookingWidget slug={slug} booking={b} />;
}
