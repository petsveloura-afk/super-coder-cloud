/**
 * Wave 17 — Ctrl+K quick actions (pure, unit-tested): typing in the global search shows
 * matching actions ("new quote", "inbox", "campaign"…) above the contact search.
 * Labels are i18n keys (cmd.<key>); keywords cover he / en / ar typing.
 */
export interface CommandAction {
  key: string;
  href: string;
  perm?: string;
  keywords: string[];
}

export const COMMAND_ACTIONS: CommandAction[] = [
  { key: "newContact", href: "/crm?new=1", perm: "contacts.write", keywords: ["ליד", "לקוח", "איש קשר", "contact", "lead", "عميل", "جهة"] },
  { key: "newTask", href: "/tasks?new=1", perm: "tasks.write", keywords: ["משימה", "תזכורת", "task", "todo", "مهمة"] },
  { key: "newQuote", href: "/finance/new?kind=quote", perm: "finance.write", keywords: ["הצעת מחיר", "הצעה", "quote", "عرض سعر"] },
  { key: "newInvoice", href: "/finance/new?kind=invoice", perm: "finance.write", keywords: ["חשבונית", "invoice", "فاتورة"] },
  { key: "newCampaign", href: "/campaigns/new", perm: "campaigns.manage", keywords: ["קמפיין", "דיוור", "תפוצה", "campaign", "broadcast", "حملة"] },
  { key: "newAutomation", href: "/automations/new", perm: "automations.manage", keywords: ["אוטומציה", "automation", "workflow", "أتمتة"] },
  { key: "newForm", href: "/forms/new", perm: "forms.manage", keywords: ["טופס", "form", "نموذج"] },
  { key: "newSite", href: "/websites/new", perm: "websites.manage", keywords: ["אתר", "דף נחיתה", "website", "landing", "موقع"] },
  { key: "inbox", href: "/inbox", perm: "inbox.read", keywords: ["הודעות", "שיחות", "וואטסאפ", "inbox", "messages", "whatsapp", "رسائل"] },
  { key: "appointments", href: "/appointments", keywords: ["פגישה", "יומן", "תור", "meeting", "calendar", "موعد"] },
  { key: "pipelines", href: "/pipelines", keywords: ["עסקאות", "צנרת", "deals", "pipeline", "صفقات"] },
  { key: "analytics", href: "/analytics", keywords: ["דוחות", "נתונים", "roi", "reports", "analytics", "تقارير"] },
  { key: "aiAgents", href: "/ai-agents", keywords: ["סוכן", "בוט", "ai", "agent", "bot", "وكيل"] },
  { key: "support", href: "/support", keywords: ["פנייה", "תמיכה", "ticket", "support", "دعم"] },
  { key: "kb", href: "/support/kb", keywords: ["מאגר ידע", "שאלות", "kb", "knowledge", "faq", "معرفة"] },
  { key: "integrations", href: "/integrations", perm: "integrations.manage", keywords: ["חיבור", "אינטגרציה", "פיקסל", "integration", "pixel", "تكامل"] },
  { key: "settings", href: "/settings", keywords: ["הגדרות", "settings", "إعدادات"] },
  { key: "billing", href: "/billing", keywords: ["מנוי", "חבילה", "תשלום", "billing", "plan", "اشتراك"] },
];

const norm = (s: string) => s.toLowerCase().replace(/[״"'׳]/g, "").trim();

/** Actions matching the typed text (label or keyword, substring), best first, max `limit`. */
export function matchCommands(q: string, label: (key: string) => string, can: (perm: string) => boolean, limit = 6): CommandAction[] {
  const n = norm(q);
  if (n.length < 2) return [];
  const scored: { a: CommandAction; s: number }[] = [];
  for (const a of COMMAND_ACTIONS) {
    if (a.perm && !can(a.perm)) continue;
    const l = norm(label(a.key));
    let s = 0;
    if (l.startsWith(n)) s = 3;
    else if (l.includes(n)) s = 2;
    else if (a.keywords.some((k) => norm(k).startsWith(n) || n.startsWith(norm(k)))) s = 2;
    else if (a.keywords.some((k) => norm(k).includes(n))) s = 1;
    if (s) scored.push({ a, s });
  }
  return scored.sort((x, y) => y.s - x.s).slice(0, limit).map((x) => x.a);
}
