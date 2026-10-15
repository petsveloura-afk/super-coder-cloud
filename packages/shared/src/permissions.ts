/**
 * Role-based access control — single TypeScript source of truth.
 *
 * The SAME matrix is seeded into Postgres (`public.role_permissions`) by
 * migration 0003. The database test-suite (tests/integration/rls.test.ts)
 * asserts that the SQL seed and this matrix are identical, so the UI,
 * server actions and RLS can never drift apart silently.
 *
 * Authorization is enforced in three layers:
 *   1. Postgres RLS via `public.has_permission(org_id, permission)`
 *   2. Server actions / route handlers via `assertPermission()`
 *   3. UI (hiding buttons) — convenience only, never trusted.
 */

export const ORG_ROLES = [
  "agency_owner",
  "owner",
  "admin",
  "manager",
  "marketing",
  "sales",
  "support",
  "analyst",
  "client",
  "read_only",
] as const;

export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSIONS = [
  "org.read",
  "org.update",
  "org.delete",
  "members.read",
  "members.invite",
  "members.manage",
  "contacts.read",
  "contacts.write",
  "contacts.delete",
  "contacts.export",
  "companies.read",
  "companies.write",
  "companies.delete",
  "deals.read",
  "deals.write",
  "deals.delete",
  "tasks.read",
  "tasks.write",
  "analytics.read",
  "audit.read",
  "settings.manage",
  "integrations.manage",
  "billing.manage",
  // v2 (migration 0011): commercial layer
  "billing.read",
  "ai.use",
  "ai.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ALL: Permission[] = [
  "org.read",
  "members.read",
  "contacts.read",
  "companies.read",
  "deals.read",
  "tasks.read",
  "analytics.read",
];

const CRM_WRITE: Permission[] = [
  "contacts.write",
  "companies.write",
  "deals.write",
  "tasks.write",
];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  agency_owner: ALL,
  owner: ALL,
  admin: ALL.filter((p) => p !== "org.delete" && p !== "billing.manage"),
  manager: [
    ...READ_ALL,
    ...CRM_WRITE,
    "contacts.delete",
    "contacts.export",
    "companies.delete",
    "deals.delete",
    "members.invite",
    "audit.read",
    "billing.read",
    "ai.use",
  ],
  marketing: [...READ_ALL, "contacts.write", "companies.write", "contacts.export", "tasks.write", "ai.use"],
  sales: [...READ_ALL, ...CRM_WRITE, "ai.use"],
  support: [...READ_ALL, "contacts.write", "tasks.write", "ai.use"],
  analyst: [...READ_ALL, "contacts.export", "audit.read"],
  client: ["org.read", "contacts.read", "companies.read", "deals.read", "tasks.read"],
  read_only: READ_ALL,
};

export function roleHasPermission(role: OrgRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

/** Roles a given role may assign to others (cannot escalate above itself). */
export function assignableRoles(actor: OrgRole): OrgRole[] {
  const rank: Record<OrgRole, number> = {
    agency_owner: 100,
    owner: 90,
    admin: 80,
    manager: 60,
    marketing: 40,
    sales: 40,
    support: 40,
    analyst: 30,
    client: 10,
    read_only: 10,
  };
  if (!roleHasPermission(actor, "members.invite")) return [];
  return ORG_ROLES.filter((r) => rank[r] < rank[actor] || (actor === "owner" && r === "owner"));
}

export class PermissionError extends Error {
  readonly code = "FORBIDDEN";
  readonly permission: Permission;
  constructor(permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.permission = permission;
  }
}

export function assertRolePermission(role: OrgRole | null | undefined, permission: Permission): void {
  if (!roleHasPermission(role, permission)) throw new PermissionError(permission);
}
