/**
 * Not-a-customer filter (pure, unit-tested; additive). Decides whether an incoming message is clearly NOT from a customer —
 * a newsletter / product update / marketing blast, an automatic notification, or a spam pitch — so the agent does not
 * answer it and the team is not alerted about it. The message is still stored and visible in the inbox; nothing is deleted.
 *
 * Conservative on purpose: a real customer must never be ignored. A message needs SEVERAL strong signals to be filtered,
 * and a short personal question ("כמה עולה תספורת?") never is.
 */
import { isServiceSender } from "@/lib/inbox/robots-core";

export type NotCustomerKind = "bulk" | "spam" | null;

const BULK = [
  /unsubscribe|opt[- ]?out|manage (your )?(email )?preferences|email preferences/i,
  /view (this )?(email )?in (your )?browser|view online version/i,
  /you(?:'re| are) receiving this (email|message)|you received this (email|because)|sent to you because/i,
  /changelog|release notes|what'?s new in|product update|newsletter|weekly digest|monthly digest/i,
  /©\s?\d{4}|all rights reserved/i,
  /להסרה מרשימת התפוצה|להסרה לחצו|הסר(?:ה)? מרשימת|קיבלת (?:את )?(?:הודעה|מייל) זה|ניוזלטר|דיוור/,
  /إلغاء الاشتراك|النشرة الإخبارية/,
];

const SPAM = [
  /\b(seo|backlinks?|guest post|link building|web traffic|rank (your|on) google)\b/i,
  /\b(crypto|bitcoin|forex|binary option|investment opportunity|guaranteed (profit|returns))\b/i,
  /\b(loan|lottery|you (have )?won|claim your (prize|reward)|inheritance)\b/i,
  /קידום אתרים|קישורים נכנסים|קידום אורגני בגוגל|מקום ראשון בגוגל/,
  /הלוואה מהירה|השקעה מובטחת|הכנסה פסיבית|קריפטו|מטבעות דיגיטליים|תשואה מובטחת/,
  /זכית בפרס|זכית ב-?\d|לקבלת הפרס/,
  /(?:https?:\/\/\S+[\s\S]*){4,}/i, // many links in one message
  /\b(click here|act now|limited time offer|100% free|risk[- ]free)\b/i,
];

const PERSONAL = /\?|^(hi|hello|hey|היי|שלום|הי|مرحبا)\b|אפשר|כמה עולה|רציתי|מתי|איפה|תור|הזמנה|מחיר|price|book|appointment|order/i;

export function notCustomerKind(input: { text: string; channel: string; automated?: boolean | null; subject?: string | null }): NotCustomerKind {
  const text = `${input.subject ?? ""}\n${input.text ?? ""}`.trim();
  if (input.automated) return "bulk";
  // a well-known service sender by its NAME only (an exchange, a platform, "… Alerts") — the text is not used here, so a
  // customer is never skipped because of what they wrote
  if (isServiceSender(input.subject ?? null, null)) return "bulk";
  if (!text) return null;
  const bulk = BULK.filter((r) => r.test(text)).length;
  const spam = SPAM.filter((r) => r.test(text)).length;
  const long = text.length > 600;
  const personalShort = text.length < 220 && PERSONAL.test(text);
  // a short personal question is a customer — unless it is plainly a pitch (two strong spam signs)
  if (personalShort && spam < 2) return null;
  // e-mail: an unsubscribe footer plus one more mass-mail sign is a newsletter
  if (input.channel === "email" && bulk >= 2) return "bulk";
  if (bulk >= 3 && long) return "bulk";
  if (spam >= 2) return "spam";
  if (spam >= 1 && bulk >= 1 && long) return "spam";
  return null;
}
