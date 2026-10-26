/** Wave 25 — password strength (pure, unit-tested). 0 = empty, 1 weak … 4 strong. Advisory only: the server rules are unchanged. */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export function passwordStrength(pw: string): StrengthLevel {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[a-z\u0590-\u05ff\u0600-\u06ff]/i.test(pw) && /\d/.test(pw)) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/[^A-Za-z0-9\u0590-\u05ff\u0600-\u06ff]/.test(pw)) score++;
  if (/^(.)\1+$/.test(pw) || /^(1234|password|qwerty|abcd)/i.test(pw)) score = Math.min(score, 1);
  if (pw.length < 8) score = Math.min(score, 1);
  return Math.max(1, Math.min(4, Math.ceil(score * 0.8))) as StrengthLevel;
}
