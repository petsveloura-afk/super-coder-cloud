/** Smarter sales manager (pure, unit-tested): the follow-up task it opens for a hot lead nobody followed up yet. */
export type Lang = "he" | "en" | "ar";

export function hotLeadTask(lang: Lang, input: { name: string; summary: string | null; channel: string }): { title: string; description: string } {
  const summary = (input.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
  const via = input.channel ? ` (${input.channel})` : "";
  if (lang === "en") return { title: `🔥 Hot lead: call ${input.name} back today`.slice(0, 200), description: `${input.name} is a hot lead in an open conversation${via} and has no follow-up yet.${summary ? `\nWhat they want: ${summary}` : ""}\nNext step: call or write personally and agree on a meeting / an offer.`.slice(0, 5000) };
  if (lang === "ar") return { title: `🔥 عميل ساخن: اتصل بـ ${input.name} اليوم`.slice(0, 200), description: `${input.name} عميل ساخن في محادثة مفتوحة${via} بلا متابعة بعد.${summary ? `\nما يريده: ${summary}` : ""}\nالخطوة التالية: تواصل شخصيًا واتفق على موعد / عرض.`.slice(0, 5000) };
  return { title: `🔥 ליד חם: לחזור ל-${input.name} היום`.slice(0, 200), description: `${input.name} הוא ליד חם בשיחה פתוחה${via}, ועדיין אין לו משימת מעקב.${summary ? `\nמה הוא רוצה: ${summary}` : ""}\nהצעד הבא: להתקשר או לכתוב אישית ולסגור פגישה או הצעה.`.slice(0, 5000) };
}
