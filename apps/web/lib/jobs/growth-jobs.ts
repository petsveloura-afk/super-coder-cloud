import "server-only";

/**
 * Waves 15-18 — side effects queued in `jobs` by the database (or the app) and run by
 * the dispatcher with retries / dead-letter:
 *   invoice     tax document in Morning / iCount for a recorded payment
 *   conversion  purchase / lead event to Meta CAPI, GA4, TikTok
 *   push        web push notification to a member's devices
 *   calendar    create / update / delete the event in Google / Outlook calendar
 *   reminder    appointment reminder to the customer (24h / 1h) with confirm / cancel
 *   call        voice escalation call to the on-duty team member
 */
export interface GrowthOutcome {
  ok: boolean;
  status?: number;
  error?: string;
  permanent?: boolean;
}

export async function runGrowthJob(kind: string, orgId: string, payload: Record<string, unknown>): Promise<GrowthOutcome> {
  switch (kind) {
    case "invoice": {
      const { issueTaxDocForPayment } = await import("@/lib/finance/invoicing");
      const r = await issueTaxDocForPayment(String(payload.payment_id ?? ""));
      return { ok: r.ok, error: r.error, permanent: r.permanent };
    }
    case "calendar": {
      const { syncAppointmentToCalendar } = await import("@/lib/calendar/sync");
      return syncAppointmentToCalendar(String(payload.appointment_id ?? ""));
    }
    case "call": {
      const { escalationCalls } = await import("@/lib/voice/agent");
      return escalationCalls(orgId, payload as { customer?: string; reason?: string; conversation_id?: string });
    }
    // wave 17
    case "conversion": {
      const { runConversionJob } = await import("@/lib/marketing/conversions");
      return runConversionJob(orgId, payload);
    }
    case "push": {
      const { runPushJob } = await import("@/lib/push/send");
      return runPushJob(orgId, payload);
    }
    default:
      return { ok: false, error: `unsupported_job:${kind}`, permanent: true };
  }
}
