import { describe, expect, it } from "vitest";
import {
  ORG_ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  assertRolePermission,
  assignableRoles,
  roleHasPermission,
  PermissionError,
} from "../src/permissions";
import { contactSchema, createOrganizationSchema, fieldErrors, signUpSchema } from "../src/validators";
import { findLeakedSecrets, integrationAvailability } from "../src/env";
import { decryptSecret, encryptSecret, generateApiKey, hashApiKey, verifyHmacSignature } from "../src/crypto";
import { createHmac, randomBytes } from "node:crypto";

describe("permissions matrix", () => {
  it("every role maps only to known permissions", () => {
    for (const role of ORG_ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });
  it("read_only and client cannot write contacts", () => {
    expect(roleHasPermission("read_only", "contacts.write")).toBe(false);
    expect(roleHasPermission("client", "contacts.write")).toBe(false);
  });
  it("only owner-level roles can delete the org or manage billing", () => {
    const can = ORG_ROLES.filter((r) => roleHasPermission(r, "org.delete"));
    expect(can.sort()).toEqual(["agency_owner", "owner"]);
    expect(roleHasPermission("admin", "billing.manage")).toBe(false);
  });
  it("null role has no permissions", () => {
    expect(roleHasPermission(null, "org.read")).toBe(false);
    expect(() => assertRolePermission(undefined, "org.read")).toThrow(PermissionError);
  });
  it("roles cannot assign roles above themselves", () => {
    expect(assignableRoles("manager")).not.toContain("admin");
    expect(assignableRoles("manager")).not.toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(assignableRoles("sales")).toEqual([]);
  });
});

describe("validators", () => {
  it("requires email or phone on contacts", () => {
    const r = contactSchema.safeParse({ firstName: "דנה" });
    expect(r.success).toBe(false);
    if (!r.success) expect(fieldErrors(r.error).email).toBe("validation.emailOrPhone");
  });
  it("normalises phone numbers and emails", () => {
    const r = contactSchema.parse({ firstName: "Dana", phone: "+972 (50) 123-4567", email: " Dana@Example.COM " });
    expect(r.phone).toBe("+972501234567");
    expect(r.email).toBe("dana@example.com");
  });
  it("rejects bad phone", () => {
    expect(contactSchema.safeParse({ firstName: "A", phone: "abc" }).success).toBe(false);
  });
  it("validates org slug", () => {
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "acme-ltd" }).success).toBe(true);
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "-bad" }).success).toBe(false);
    expect(createOrganizationSchema.safeParse({ name: "Acme", slug: "a b" }).success).toBe(false);
  });
  it("enforces password strength", () => {
    expect(signUpSchema.safeParse({ fullName: "Tom", email: "t@x.io", password: "short1" }).success).toBe(false);
    expect(signUpSchema.safeParse({ fullName: "Tom", email: "t@x.io", password: "onlyletterslong" }).success).toBe(false);
    expect(signUpSchema.safeParse({ fullName: "Tom", email: "t@x.io", password: "letters12345" }).success).toBe(true);
  });
});

describe("env", () => {
  it("flags secrets exposed via NEXT_PUBLIC_", () => {
    expect(findLeakedSecrets({ NEXT_PUBLIC_SUPABASE_ANON_KEY: "x", NEXT_PUBLIC_OPENAI_API_KEY: "y" })).toEqual([
      "NEXT_PUBLIC_OPENAI_API_KEY",
    ]);
  });
  it("disables integrations without credentials", () => {
    const a = integrationAvailability({ OPENAI_API_KEY: "k", WHATSAPP_ACCESS_TOKEN: "t" });
    expect(a.openai).toBe(true);
    expect(a.whatsapp).toBe(false);
    expect(a.email).toBe(false);
  });
});

describe("crypto", () => {
  const k = randomBytes(32).toString("hex");
  it("round-trips encrypted secrets", () => {
    const enc = encryptSecret("bot-token-123", k);
    expect(enc).not.toContain("bot-token-123");
    expect(decryptSecret(enc, k)).toBe("bot-token-123");
  });
  it("detects tampering", () => {
    const enc = encryptSecret("x", k).split(":");
    enc[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(enc.join(":"), k)).toThrow();
  });
  it("hashes api keys deterministically", () => {
    const { key, hash, prefix } = generateApiKey();
    expect(hashApiKey(key)).toBe(hash);
    expect(key.startsWith(prefix)).toBe(true);
  });
  it("verifies hmac signatures in constant time", () => {
    const sig = createHmac("sha256", "s3cret").update("body").digest("hex");
    expect(verifyHmacSignature("body", `sha256=${sig}`, "s3cret")).toBe(true);
    expect(verifyHmacSignature("body2", sig, "s3cret")).toBe(false);
    expect(verifyHmacSignature("body", "zz", "s3cret")).toBe(false);
  });
});
