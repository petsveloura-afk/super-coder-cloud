import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isFullRefund, isRefundEvent, refundAmount, refundedPaymentIds, storedIdsFor } from "@/lib/billing/refunds-core";
import { businessDomain, companyKey, companyStats, nameFromDomain, sortFilterCompanies, suggestCompanies } from "@/lib/crm/companies-core";
import { automationFingerprint, duplicateGroups } from "@/lib/automations/dup-core";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("billing — refunds and chargebacks", () => {
  it("knows the four refund events and finds the ORIGINAL payment id in each", () => {
    expect(isRefundEvent("PAYMENT.CAPTURE.REFUNDED")).toBe(true);
    expect(isRefundEvent("PAYMENT.CAPTURE.COMPLETED")).toBe(false);
    expect(refundedPaymentIds("PAYMENT.CAPTURE.REFUNDED", { id: "REF123456", links: [{ rel: "self", href: "https://api.paypal.com/v2/payments/refunds/REF123456" }, { rel: "up", href: "https://api.paypal.com/v2/payments/captures/CAP9876543" }] })).toEqual(["CAP9876543"]);
    expect(refundedPaymentIds("PAYMENT.CAPTURE.REVERSED", { id: "CAP9876543" })).toEqual(["CAP9876543"]);
    expect(refundedPaymentIds("PAYMENT.SALE.REFUNDED", { id: "RFD111111", sale_id: "SALE222222" })).toEqual(["SALE222222"]);
    expect(refundedPaymentIds("PAYMENT.CAPTURE.REFUNDED", { links: "bad" })).toEqual([]);
    expect(refundedPaymentIds("PAYMENT.CAPTURE.REVERSED", { id: "x'; drop" })).toEqual([]);
  });

  it("matches every way a payment is stored (credit pack, plan by card, subscription sale)", () => {
    expect(storedIdsFor("CAP1")).toEqual(["CAP1", "paypal:CAP1", "capture:CAP1"]);
  });

  it("credits are taken back only on a full refund or a chargeback", () => {
    expect(refundAmount({ amount: { value: "29.00", currency_code: "usd" } })).toEqual({ amount: 29, currency: "USD" });
    expect(isFullRefund("PAYMENT.CAPTURE.REFUNDED", 29, 29)).toBe(true);
    expect(isFullRefund("PAYMENT.CAPTURE.REFUNDED", 29, 10)).toBe(false);
    expect(isFullRefund("PAYMENT.CAPTURE.REVERSED", 29, 10)).toBe(true);
    expect(isFullRefund("PAYMENT.SALE.REFUNDED", 29, null)).toBe(true);
  });

  it("wired: webhook branches, the migration (never below zero, once per purchase), payment-failed notice, sale alert, admin void/delete", () => {
    const hook = read("app/api/webhooks/paypal/route.ts");
    expect(hook).toContain("processRefundEvent(type, r)");
    expect(hook).toContain('type === "BILLING.SUBSCRIPTION.PAYMENT.FAILED"');
    expect(hook).toContain("processPackPayPal(orderId)"); // the existing paths stay
    const sql = read("../../supabase/migrations/20261112000001_billing_refunds.sql");
    expect(sql).toContain("least(cp.credits::bigint, left_now)");
    expect(sql).toContain("credit_ledger_refund_once");
    expect(sql).toContain("'voided'");
    expect(read("lib/billing/receipts.ts")).toContain("emailPlatformSale(p, r)");
    const adm = read("app/[locale]/(dashboard)/admin/payment-actions.ts");
    expect(adm).toContain("ctx.isPlatformAdmin");
    expect(adm).toContain('!== "DELETE"');
    expect(adm.indexOf('from("audit_logs").insert(entries)')).toBeLessThan(adm.indexOf('from("billing_payments").delete()'));
  });
});

describe("companies — found in the contacts, numbers, sort / filter", () => {
  it("business domains only (not gmail / walla), stable keys, readable names", () => {
    expect(businessDomain("dana@acme-tools.co.il")).toBe("acme-tools.co.il");
    expect(businessDomain("dana@gmail.com")).toBeNull();
    expect(businessDomain("x@walla.co.il")).toBeNull();
    expect(companyKey(' Acme  Ltd. ')).toBe(companyKey("acme"));
    expect(companyKey('אקמי בע"מ')).toBe(companyKey("אקמי"));
    expect(nameFromDomain("acme-tools.co.il")).toBe("Acme Tools");
  });

  it("groups unlinked contacts into companies, links to existing ones instead of duplicating", () => {
    const plan = suggestCompanies(
      [
        { id: "1", company_name: "Acme Ltd", email: "a@acme.com" },
        { id: "2", company_name: "ACME", email: null },
        { id: "3", company_name: null, email: "b@beta.io" },
        { id: "4", company_name: null, email: "c@beta.io" },
        { id: "5", company_name: null, email: "d@gmail.com" },
        { id: "6", company_name: "Gamma", email: null },
      ],
      [{ id: "g", name: "gamma", domain: null }],
    );
    expect(plan.create.map((c) => [c.name, c.contactIds])).toEqual([
      ["Acme Ltd", ["1", "2"]],
      ["Beta", ["3", "4"]],
    ]);
    expect(plan.create[0]!.domain).toBe("acme.com");
    expect(plan.link).toEqual([{ companyId: "g", contactIds: ["6"] }]);
  });

  it("one company even when the contacts wrote its name differently, if the business domain is the same", () => {
    const plan = suggestCompanies(
      [
        { id: "1", company_name: 'אקמי בע"מ', email: "ron@acme.co.il" },
        { id: "2", company_name: "Acme", email: "galit@acme.co.il" },
        { id: "3", company_name: null, email: "x@acme.co.il" },
        { id: "4", company_name: "Acme", email: null },
      ],
      [],
    );
    expect(plan.create.length).toBe(1);
    expect(plan.create[0]).toMatchObject({ name: 'אקמי בע"מ', domain: "acme.co.il" });
    expect(plan.create[0]!.contactIds.sort()).toEqual(["1", "2", "3", "4"]);
  });

  it("pipeline / won per company; sort and filter", () => {
    const st = companyStats([{ company_id: "a" }, { company_id: "a" }, { company_id: null }], [
      { company_id: "a", value: 100, status: "open" },
      { company_id: "b", value: "500", status: "won" },
      { company_id: "b", value: 50, status: "lost" },
    ]);
    expect(st.get("a")).toEqual({ contacts: 2, openDeals: 1, pipeline: 100, won: 0 });
    expect(st.get("b")).toEqual({ contacts: 0, openDeals: 0, pipeline: 0, won: 500 });
    const rows = [
      { id: "a", name: "Alpha", created_at: "2026-01-01" },
      { id: "b", name: "Beta", created_at: "2026-02-01" },
      { id: "c", name: "Cee", created_at: "2026-03-01" },
    ];
    expect(sortFilterCompanies(rows, st, "won", "all").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortFilterCompanies(rows, st, "name", "open_deals").map((r) => r.id)).toEqual(["a"]);
    expect(sortFilterCompanies(rows, st, "newest", "no_contacts").map((r) => r.id)).toEqual(["c", "b"]);
    expect(sortFilterCompanies(rows, st, "name", "customers").map((r) => r.id)).toEqual(["b"]);
  });

  it("the sync never touches contacts that already have a company and needs both permissions", () => {
    const src = read("app/[locale]/(dashboard)/companies/sync-actions.ts");
    expect((src.match(/\.is\("company_id", null\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(src).toContain('ctx.can("companies.write") || !ctx.can("contacts.write")');
  });
});

describe("automations — duplicates and sorting", () => {
  it("same trigger + settings + conditions + steps = duplicate (key order and empty values do not matter)", () => {
    const a = { trigger_type: "contact.created", trigger_config: { a: "1", b: "" }, conditions: [], actions: [{ type: "task", title: "x" }] };
    const b = { trigger_type: "contact.created", trigger_config: { a: "1" }, conditions: [], actions: [{ title: "x", type: "task" }] };
    expect(automationFingerprint(a)).toBe(automationFingerprint(b));
    const g = duplicateGroups([
      { id: "1", ...a },
      { id: "2", ...b },
      { id: "3", ...a, trigger_type: "webhook.received" },
    ]);
    expect(g.get("1")).toBe(2);
    expect(g.get("2")).toBe(2);
    expect(g.has("3")).toBe(false);
  });

  it("the list shows the duplicate badge, a filter and a sort — the existing filters stay", () => {
    const v = read("components/automations/list-view.tsx");
    expect(v).toContain("automation-dup");
    expect(v).toContain('"duplicates"');
    expect(v).toContain('it("o.fAttention")');
    expect(read("app/[locale]/(dashboard)/automations/page.tsx")).toContain("duplicates: dups.get(a.id as string) ?? 0");
  });
});

describe("AI team — a goal can be deleted", () => {
  it("only when nothing of it is running; the whole goal with its tasks; logged", () => {
    const src = read("app/[locale]/(dashboard)/ai-team/history-actions.ts");
    expect(src).toContain("export async function deleteGoalAction");
    expect(src).toContain('return { error: "aiTeam.goal.deleteRunning" }');
    expect(src).toContain("Goal deleted by a manager");
    expect(read("components/ai-team/panels.tsx")).toContain("goal-delete-confirm");
  });
});
