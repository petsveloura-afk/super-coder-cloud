/**
 * Short, standard addresses for the platform's legal pages (pure, unit-tested).
 * Meta / Google / Shopify reviewers and people type the usual names — /privacy, /terms, /data-deletion — while the pages
 * live at /{locale}/legal/{doc}. A published website on its own domain keeps its own /privacy and /terms (handled first,
 * in the proxy); these aliases only apply on the platform's own address.
 */
import { LEGAL_DOCS, type LegalDoc } from "./platform";

const ALIASES: Record<string, LegalDoc | ""> = {
  "/legal": "",
  "/privacy": "privacy",
  "/privacy-policy": "privacy",
  "/policy": "privacy",
  "/terms": "terms",
  "/terms-of-service": "terms",
  "/terms-of-use": "terms",
  "/tos": "terms",
  "/data-deletion": "data-deletion",
  "/delete-data": "data-deletion",
  "/data-deletion-instructions": "data-deletion",
  "/user-data-deletion": "data-deletion",
  "/acceptable-use": "acceptable-use",
  "/acceptable-use-policy": "acceptable-use",
  "/rules": "acceptable-use",
  "/usage-rules": "acceptable-use",
};

/** "/privacy" → "privacy"; "/legal" → the privacy policy; anything else → null (sub-path after the locale) */
export function legalAliasDoc(subPath: string): LegalDoc | null {
  const p = String(subPath ?? "").toLowerCase().replace(/\/+$/, "").replace(/\.html?$/, "") || "/";
  if (!(p in ALIASES)) return null;
  const d = ALIASES[p]!;
  return d === "" ? LEGAL_DOCS[0]! : d;
}
