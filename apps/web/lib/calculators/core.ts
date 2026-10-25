/**
 * Wave 24 — business calculators (pure, unit-tested). Every function returns plain numbers rounded
 * to agorot (2 decimals) so the screen and the tests agree. Invalid input → null, never NaN.
 */
export const IL_VAT = 18; // Israel VAT since 1.1.2025 (editable in the screen)

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ok = (...n: number[]) => n.every((x) => Number.isFinite(x));

/** VAT: from a price before VAT (add) or a price that includes VAT (extract). */
export function vat(amount: number, ratePct = IL_VAT, mode: "add" | "extract" = "add") {
  if (!ok(amount, ratePct) || ratePct < 0) return null;
  const rate = ratePct / 100;
  const net = mode === "add" ? amount : amount / (1 + rate);
  const gross = mode === "add" ? amount * (1 + rate) : amount;
  return { net: r2(net), vat: r2(gross - net), gross: r2(gross) };
}

/** Margin vs. markup from cost and price. */
export function margin(cost: number, price: number) {
  if (!ok(cost, price) || price <= 0 || cost < 0) return null;
  const profit = price - cost;
  return { profit: r2(profit), marginPct: r2((profit / price) * 100), markupPct: cost > 0 ? r2((profit / cost) * 100) : null };
}

/** The price to ask for a wanted margin (%). */
export function priceForMargin(cost: number, marginPct: number) {
  if (!ok(cost, marginPct) || cost < 0 || marginPct >= 100 || marginPct < 0) return null;
  return r2(cost / (1 - marginPct / 100));
}

/** Discount: final price and saving; optional second discount on top. */
export function discount(price: number, pct: number, extraPct = 0) {
  if (!ok(price, pct, extraPct) || price < 0 || pct < 0 || pct > 100 || extraPct < 0 || extraPct > 100) return null;
  const final = price * (1 - pct / 100) * (1 - extraPct / 100);
  return { final: r2(final), saved: r2(price - final), effectivePct: price > 0 ? r2(((price - final) / price) * 100) : 0 };
}

/** Loan / installments (Shpitzer — equal monthly payments). annualPct 0 → plain division. */
export function loan(principal: number, annualPct: number, months: number) {
  if (!ok(principal, annualPct, months) || principal <= 0 || months < 1 || annualPct < 0) return null;
  const n = Math.round(months);
  const i = annualPct / 100 / 12;
  const monthly = i === 0 ? principal / n : (principal * i) / (1 - Math.pow(1 + i, -n));
  const total = monthly * n;
  return { monthly: r2(monthly), total: r2(total), interest: r2(total - principal) };
}

/** Break-even: how many units (and what revenue) cover the fixed costs. */
export function breakEven(fixedCosts: number, pricePerUnit: number, variableCostPerUnit: number) {
  if (!ok(fixedCosts, pricePerUnit, variableCostPerUnit) || fixedCosts < 0) return null;
  const contribution = pricePerUnit - variableCostPerUnit;
  if (contribution <= 0) return null;
  const units = Math.ceil(fixedCosts / contribution);
  return { units, revenue: r2(units * pricePerUnit), contribution: r2(contribution) };
}

/** Sales commission: flat % or with a bonus % above a target. */
export function commission(sales: number, pct: number, target = 0, bonusPct = 0) {
  if (!ok(sales, pct, target, bonusPct) || sales < 0 || pct < 0) return null;
  const base = (sales * pct) / 100;
  const bonus = target > 0 && sales > target ? ((sales - target) * bonusPct) / 100 : 0;
  return { base: r2(base), bonus: r2(bonus), total: r2(base + bonus) };
}

/** Hourly rate for a freelancer: wanted monthly net + expenses over billable hours. */
export function hourlyRate(monthlyGoal: number, monthlyExpenses: number, billableHoursPerMonth: number, taxPct = 30) {
  if (!ok(monthlyGoal, monthlyExpenses, billableHoursPerMonth, taxPct) || billableHoursPerMonth <= 0 || taxPct >= 100 || taxPct < 0) return null;
  const needed = monthlyGoal / (1 - taxPct / 100) + monthlyExpenses;
  const rate = needed / billableHoursPerMonth;
  return { rate: r2(rate), rateWithVat: r2(rate * (1 + IL_VAT / 100)), monthlyRevenue: r2(needed) };
}

/** AI agent ROI: hours the agent saves × hourly cost + extra deals, vs. what it costs. */
export function agentRoi(conversationsPerMonth: number, minutesPerConversation: number, hourlyCost: number, monthlyCost: number, extraDeals = 0, dealValue = 0) {
  if (!ok(conversationsPerMonth, minutesPerConversation, hourlyCost, monthlyCost, extraDeals, dealValue) || conversationsPerMonth < 0 || monthlyCost < 0) return null;
  const hoursSaved = (conversationsPerMonth * minutesPerConversation) / 60;
  const value = hoursSaved * hourlyCost + extraDeals * dealValue;
  return { hoursSaved: r2(hoursSaved), value: r2(value), net: r2(value - monthlyCost), roiPct: monthlyCost > 0 ? Math.round(((value - monthlyCost) / monthlyCost) * 100) : null };
}

/** Customer lifetime value and the most you should pay to win a customer (LTV / 3). */
export function ltv(avgOrder: number, ordersPerYear: number, years: number, marginPct = 100) {
  if (!ok(avgOrder, ordersPerYear, years, marginPct) || avgOrder < 0 || ordersPerYear < 0 || years < 0) return null;
  const value = avgOrder * ordersPerYear * years * (marginPct / 100);
  return { ltv: r2(value), maxCac: r2(value / 3) };
}

export interface QuoteLine { qty: number; price: number }
/** Quick quote: lines, discount %, VAT. */
export function quickQuote(lines: QuoteLine[], discountPct = 0, ratePct = IL_VAT) {
  if (!lines.every((l) => ok(l.qty, l.price) && l.qty >= 0) || !ok(discountPct, ratePct) || discountPct < 0 || discountPct > 100) return null;
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const afterDiscount = subtotal * (1 - discountPct / 100);
  const v = afterDiscount * (ratePct / 100);
  return { subtotal: r2(subtotal), discount: r2(subtotal - afterDiscount), net: r2(afterDiscount), vat: r2(v), total: r2(afterDiscount + v) };
}

/** Percent change / what share A is of B. */
export function percentChange(from: number, to: number) {
  if (!ok(from, to) || from === 0) return null;
  return r2(((to - from) / Math.abs(from)) * 100);
}

/** Campaign: cost per lead, cost per customer and return on ad spend. */
export function campaign(spend: number, leads: number, customers: number, revenue: number) {
  if (!ok(spend, leads, customers, revenue) || spend < 0) return null;
  return {
    cpl: leads > 0 ? r2(spend / leads) : null,
    cac: customers > 0 ? r2(spend / customers) : null,
    conversionPct: leads > 0 ? r2((customers / leads) * 100) : null,
    roas: spend > 0 ? r2(revenue / spend) : null,
  };
}

/** Employer cost of a salary (rough Israeli employer add-ons: social security + pension + severance). */
export function employerCost(grossSalary: number, addOnsPct = 18.5) {
  if (!ok(grossSalary, addOnsPct) || grossSalary < 0 || addOnsPct < 0) return null;
  const add = (grossSalary * addOnsPct) / 100;
  return { addOns: r2(add), total: r2(grossSalary + add), yearly: r2((grossSalary + add) * 12) };
}

export const CALCULATORS = ["vat", "margin", "discount", "loan", "breakEven", "commission", "hourly", "roi", "ltv", "quote", "campaign", "percent", "employer"] as const;
export type CalculatorKey = (typeof CALCULATORS)[number];

/** Parse a user number: "1,234.5" / "1 234" / "₪500" → number; empty → NaN. */
export function num(v: string | number | null | undefined): number {
  if (typeof v === "number") return v;
  if (!v) return NaN;
  const s = v.replace(/[₪$€%\s,]/g, "");
  return s === "" || s === "-" ? NaN : Number(s);
}
