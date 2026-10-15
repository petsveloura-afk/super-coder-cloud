/**
 * Sanitises free-text search before it is embedded in a PostgREST `or=()`
 * filter. Only letters (any script), digits, spaces and . @ + - _ survive, so
 * a user cannot inject extra filter clauses (commas, parentheses, dots-ops)
 * or wildcard characters (% * _ are escaped/removed).
 */
export function sanitizeSearch(input: string | null | undefined, max = 80): string {
  if (!input) return "";
  return input
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s@.+\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function contactSearchFilter(q: string): string | null {
  const s = sanitizeSearch(q);
  if (!s) return null;
  // Phone numbers are stored without separators; search digits form too.
  const digits = s.replace(/[^\d+]/g, "");
  const parts = [
    `first_name.ilike.*${s}*`,
    `last_name.ilike.*${s}*`,
    `email.ilike.*${s}*`,
    `company_name.ilike.*${s}*`,
  ];
  if (digits.length >= 3) parts.push(`phone.ilike.*${digits}*`);
  return parts.join(",");
}
