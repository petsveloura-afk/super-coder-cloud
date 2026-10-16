import { describe, expect, it } from "vitest";
import { companySchema, csvToImportRows, dealSchema, mapImportHeader, parseCsv, taskSchema } from "../src/validators";

describe("CSV parsing (import)", () => {
  it("handles quotes, escaped quotes, CRLF, BOM and blank lines", () => {
    const csv = '﻿name,email\r\n"Cohen, Dana","dana@x.io"\r\n\r\n"He said ""hi""",b@x.io\n';
    expect(parseCsv(csv)).toEqual([
      ["name", "email"],
      ["Cohen, Dana", "dana@x.io"],
      ['He said "hi"', "b@x.io"],
    ]);
  });

  it("auto-detects ; and tab delimiters (Excel in many locales)", () => {
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("maps Hebrew, Arabic and English headers", () => {
    expect(mapImportHeader("שם פרטי")).toBe("first_name");
    expect(mapImportHeader("טלפון")).toBe("phone");
    expect(mapImportHeader("البريد الإلكتروني")).toBe("email");
    expect(mapImportHeader("E-mail")).toBe("email");
    expect(mapImportHeader("Last Name")).toBe("last_name");
    expect(mapImportHeader("favourite colour")).toBeNull();
  });

  it("splits a full-name column, normalises status/consent and unknown sources", () => {
    const { records, columns } = csvToImportRows(parseCsv("שם מלא,מייל,סטטוס,הסכמה,מקור,junk\nדנה כהן לוי,d@x.io,לקוח,כן,tiktok,zzz"));
    expect(columns).toEqual(["first_name", "email", "status", "marketing_consent", "source", null]);
    expect(records[0]).toEqual({ first_name: "דנה", last_name: "כהן לוי", email: "d@x.io", status: "customer", marketing_consent: true, source: "import" });
  });
});

describe("wave 1 schemas", () => {
  it("company domain is normalised from a URL", () => {
    expect(companySchema.parse({ name: "Acme", domain: "https://WWW.Acme.co.il/about" }).domain).toBe("www.acme.co.il");
    expect(companySchema.safeParse({ name: "Acme", domain: "not a domain" }).success).toBe(false);
  });

  it("deal requires pipeline + stage ids and a non-negative value", () => {
    const id = "6f9619ff-8b86-4d11-b42d-00c04fc964ff";
    expect(dealSchema.safeParse({ title: "X", value: "100", pipelineId: id, stageId: id }).success).toBe(true);
    expect(dealSchema.safeParse({ title: "X", value: "-1", pipelineId: id, stageId: id }).success).toBe(false);
    expect(dealSchema.safeParse({ title: "", pipelineId: id, stageId: id }).success).toBe(false);
    expect(dealSchema.parse({ title: "X", pipelineId: id, stageId: id, contactId: "" }).contactId).toBeUndefined();
  });

  it("task due date must be a real date", () => {
    expect(taskSchema.safeParse({ title: "Call", dueAt: "2026-10-20T10:00:00.000Z" }).success).toBe(true);
    expect(taskSchema.safeParse({ title: "Call", dueAt: "tomorrow-ish" }).success).toBe(false);
  });
});
