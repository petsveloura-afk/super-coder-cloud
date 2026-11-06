/**
 * Push fix (browser side, additive): one place that makes sure THIS device has a working subscription for the server's current key.
 *   - no subscription yet               → subscribe
 *   - a subscription made with an old key (the VAPID keys were changed) → unsubscribe + subscribe again
 *     (before, the old one was reused forever and every push was refused by the push service)
 * Never asks for permission by itself: callers ask (a click) or only run when permission is already "granted".
 */
export function keyToBytes(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const raw = atob((b64u + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** is this subscription bound to the given server key? (unknown → true: browsers that do not expose it keep the subscription) */
export function sameServerKey(current: ArrayBuffer | null | undefined, vapidKey: string): boolean {
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = keyToBytes(vapidKey);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function ensureSubscription(vapidKey: string): Promise<PushSubscription> {
  const reg = (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameServerKey(sub.options?.applicationServerKey ?? null, vapidKey)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  return sub ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(vapidKey) }));
}

export function subPayload(sub: PushSubscription): { endpoint?: string; p256dh?: string; auth?: string } {
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  return { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth };
}
