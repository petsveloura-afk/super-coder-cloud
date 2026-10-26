/**
 * Embedded Signup — the popup's FINISH message (phone_number_id + waba_id) can arrive a moment
 * after FB.login's callback, or not at all in some flows (e.g. Coexistence). Wait for it, but never
 * longer than `ms`; the server then looks the ids up from the token itself.
 */
export async function waitForSignup(ref: { current: { phone_number_id?: string; waba_id?: string } }, ms = 1200): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (ref.current.phone_number_id && ref.current.waba_id) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}
