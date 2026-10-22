import "server-only";

/** Steps added by waves 16-18 (calendars, appointment reminders, A/B tests, conversions…). */
export function moreGrowthSteps(): [string, () => Promise<Record<string, unknown>>][] {
  return [
    [
      "calendars",
      async () => {
        const { refreshCalendarBusy } = await import("@/lib/calendar/sync");
        return { ...(await refreshCalendarBusy(15)) };
      },
    ],
    // wave 17
    [
      "appointmentReminders",
      async () => {
        const { runAppointmentReminders } = await import("@/lib/appointments/reminders");
        return { ...(await runAppointmentReminders(15_000)) };
      },
    ],
    [
      "abTests",
      async () => {
        const { decideAbTests } = await import("@/lib/site/ab");
        return { ...(await decideAbTests()) };
      },
    ],
    [
      "siteEventsRetention",
      async () => {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const { data } = await createAdminClient().rpc("purge_site_events", { p_days: 180, p_limit: 20000 });
        return { purged: Number(data ?? 0) };
      },
    ],
  ];
}
