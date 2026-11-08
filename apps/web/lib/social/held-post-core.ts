/**
 * Wave A3 — a post the customer-ready guard holds (pure, no I/O, unit-tested).
 *
 * Publishing already puts an AI-written post that is "not ready for customers" (unfilled placeholder, raw JSON, leaked
 * instructions…) back to a draft with `results.hygiene = "not_ready"` (lib/social/publish.ts). Until now the board did not know
 * about it: the buttons stayed, "publish now" answered "publishing" although the post was held again, and "approve all"
 * scheduled it only to be held again.
 *
 * This module answers one question with the SAME test the publisher uses (assessCustomerText over the text as it would go out),
 * so the board never offers what publishing would hold. It looks at the text, not at the old marker: the moment the owner fixes
 * the words, the post is no longer held.
 */
import { assessCustomerText, outboundGuardMode } from "@/lib/ai/outbound-guard-core";
import { outgoingText } from "./post-hygiene-core";

export interface HeldPostInput {
  body: string;
  source?: string | null;
  results?: Record<string, unknown> | null;
}

/** true = an AI-written post whose text is not ready for customers (the same check as the publisher). Never throws. */
export function isNotReadyForCustomers(p: HeldPostInput): boolean {
  try {
    if (p.source !== "agent") return false;
    return !assessCustomerText(outgoingText(String(p.body ?? ""), "agent")).ok;
  } catch {
    return false;
  }
}

/** what the board shows: the publisher held this post (marker) AND the text is still not ready (the owner may have fixed it since). */
export function isHeldByGuard(p: HeldPostInput): boolean {
  return p.results?.hygiene === "not_ready" && isNotReadyForCustomers(p);
}

/**
 * what the server actions refuse: approving / scheduling / publishing a post the publisher would hold again. Only while the guard
 * is enforcing (OUTBOUND_GUARD=off|clean never holds, so nothing is refused then).
 */
export function wouldBeHeld(p: HeldPostInput, guardEnv: string | null | undefined): boolean {
  return outboundGuardMode(guardEnv) === "enforce" && isNotReadyForCustomers(p);
}
