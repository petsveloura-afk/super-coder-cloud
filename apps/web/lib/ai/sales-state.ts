import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSalesState, type SalesState, type Transition } from "./sales-state-core";

/**
 * Wave 55 — persists the conversation's sales funnel state and syncs every move to the CRM:
 * the conversation row (state + time), an event log (for the funnel analytics) and an activity
 * on the customer's timeline. Best-effort: before the migration ran everything is a silent no-op.
 */
export async function loadSalesState(conversationId: string): Promise<SalesState | null> {
  try {
    const { data, error } = await createAdminClient().from("conversations").select("sales_state").eq("id", conversationId).maybeSingle();
    if (error || !data) return null;
    const s = (data as { sales_state?: unknown }).sales_state;
    return isSalesState(s) ? s : null;
  } catch {
    return null;
  }
}

export async function applySalesTransition(input: { orgId: string; conversationId: string; contactId: string | null; from: SalesState | null; transition: Transition }): Promise<boolean> {
  const { transition: t } = input;
  // the very first state is stored too (NEW_LEAD / QUALIFYING_NEEDS …), later only real changes
  if (!t.changed && input.from !== null) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("conversations").update({ sales_state: t.next, sales_state_at: new Date().toISOString() }).eq("id", input.conversationId).eq("organization_id", input.orgId);
    if (error) return false;
    await admin.from("conversation_state_events").insert({ organization_id: input.orgId, conversation_id: input.conversationId, from_state: input.from, to_state: t.next, reason: t.reason.slice(0, 200), source: "agent" });
    if (input.contactId && input.from !== null) {
      await admin.from("activities").insert({ organization_id: input.orgId, contact_id: input.contactId, type: "sales_state", payload: { from: input.from, to: t.next, reason: t.reason.slice(0, 200), conversation_id: input.conversationId } });
    }
    return true;
  } catch (e) {
    console.error("sales state update failed", (e as Error).message);
    return false;
  }
}
