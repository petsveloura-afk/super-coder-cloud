/**
 * Row types for the tables used by the application layer.
 * Kept hand-written and small for Phase 1; regenerate a full typed client with
 *   pnpm dlx supabase gen types typescript --project-id <id> > packages/database/src/supabase.gen.ts
 * once a Supabase project is linked.
 */
import type { OrgRole } from "@scc/shared/permissions";

export type ContactStatus = "lead" | "qualified" | "customer" | "inactive";

export interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  locale: "he" | "ar" | "en";
  timezone: string;
  currency: string;
  plan: string;
  is_demo: boolean;
  parent_organization_id: string | null;
  created_at: string;
}

export interface MembershipRow {
  organization_id: string;
  user_id: string;
  role: OrgRole;
}

export interface MembershipWithOrg extends MembershipRow {
  organizations: Pick<OrganizationRow, "id" | "name" | "slug" | "is_demo" | "currency" | "locale"> | null;
}

export interface ContactRow {
  id: string;
  organization_id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  job_title: string | null;
  company_name: string | null;
  status: ContactStatus;
  source: string;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  is_demo: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
  body: string;
  created_by: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: number;
  organization_id: string | null;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface DashboardKpis {
  total_contacts: number;
  new_contacts: number;
  qualified_contacts: number;
  customers: number;
  open_deals: number;
  open_pipeline_value: number;
  won_value: number;
  won_deals: number;
  lost_deals: number;
  open_tasks: number;
  overdue_tasks: number;
}

export interface DailyPoint {
  day: string;
  count: number;
}
