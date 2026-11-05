/** sender names that are always an automatic e-mail, never a customer (pure, unit-tested) */
const ROBOT_NAME = /^(mail delivery (subsystem|system)|mailer[- ]daemon|postmaster|no[- ]?reply|do[- ]?not[- ]?reply|notifications?|microsoft outlook|google( workspace)? (alerts|calendar)|delivery status notification)\b/i;

export function isRobotName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  if (!n) return false;
  if (ROBOT_NAME.test(n)) return true;
  return /^(no-?reply|noreply|mailer-daemon|postmaster|notifications?|bounce[s]?)@/i.test(n);
}
