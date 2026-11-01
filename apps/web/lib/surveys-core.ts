/** Satisfaction surveys (pure): the question, the scale and the message that carries the link. */
export type SurveyKind = "nps" | "csat" | "ces";

export const SCALE: Record<SurveyKind, { min: number; max: number }> = { nps: { min: 0, max: 10 }, csat: { min: 1, max: 5 }, ces: { min: 1, max: 7 } };

export function scaleValues(kind: SurveyKind): number[] {
  const { min, max } = SCALE[kind];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

const Q: Record<"he" | "en" | "ar", Record<SurveyKind, string>> = {
  he: { nps: "עד כמה תמליצו עלינו לחבר או לקולגה?", csat: "כמה הייתם מרוצים מהשירות שקיבלתם?", ces: "כמה קל היה לקבל מאיתנו את מה שהייתם צריכים?" },
  en: { nps: "How likely are you to recommend us to a friend or colleague?", csat: "How satisfied were you with the service you received?", ces: "How easy was it to get what you needed from us?" },
  ar: { nps: "ما مدى احتمال أن توصي بنا لصديق أو زميل؟", csat: "ما مدى رضاك عن الخدمة التي تلقيتها؟", ces: "ما مدى سهولة حصولك على ما تحتاجه منا؟" },
};

export function surveyQuestion(kind: SurveyKind, locale: string, custom?: string | null): string {
  if (custom && custom.trim()) return custom.trim();
  return Q[locale === "en" || locale === "ar" ? locale : "he"][kind];
}

export function surveyMessage(input: { kind: SurveyKind; locale: string; orgName: string; link: string; custom?: string | null }): string {
  const q = surveyQuestion(input.kind, input.locale, input.custom);
  if (input.locale === "en") return `Thank you for contacting ${input.orgName}! 🙏\n${q}\nOne click to answer: ${input.link}`;
  if (input.locale === "ar") return `شكرًا لتواصلك مع ${input.orgName}! 🙏\n${q}\nنقرة واحدة للإجابة: ${input.link}`;
  return `תודה שפניתם ל-${input.orgName}! 🙏\n${q}\nלחיצה אחת לדירוג: ${input.link}`;
}

/** Labels at the two ends of the scale. */
export function scaleEnds(kind: SurveyKind, locale: string): [string, string] {
  const l = locale === "en" || locale === "ar" ? locale : "he";
  const T = {
    he: { nps: ["בכלל לא", "בהחלט"], csat: ["לא מרוצה", "מרוצה מאוד"], ces: ["קל מאוד", "קשה מאוד"] },
    en: { nps: ["Not at all", "Extremely likely"], csat: ["Unsatisfied", "Very satisfied"], ces: ["Very easy", "Very hard"] },
    ar: { nps: ["إطلاقًا", "بالتأكيد"], csat: ["غير راضٍ", "راضٍ جدًا"], ces: ["سهل جدًا", "صعب جدًا"] },
  } as const;
  return T[l][kind] as unknown as [string, string];
}
