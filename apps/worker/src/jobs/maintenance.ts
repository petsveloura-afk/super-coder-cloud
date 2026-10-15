import type pg from "pg";

/**
 * Maintenance jobs (Phase 1). Each job is idempotent and safe to re-run.
 * The worker connects with DATABASE_URL (server-side only, bypasses RLS),
 * so every statement here is explicitly scoped and reviewed.
 */

/** Delete invitations that expired more than `graceDays` ago and were never accepted. */
export async function purgeExpiredInvitations(db: pg.Pool | pg.Client, graceDays = 30): Promise<number> {
  const res = await db.query(
    `delete from public.invitations
      where accepted_at is null
        and expires_at < now() - make_interval(days => $1::int)`,
    [graceDays],
  );
  return res.rowCount ?? 0;
}

/** Remove read notifications older than `days` to keep the table small. */
export async function purgeOldNotifications(db: pg.Pool | pg.Client, days = 90): Promise<number> {
  const res = await db.query(
    `delete from public.notifications
      where read_at is not null and created_at < now() - make_interval(days => $1::int)`,
    [days],
  );
  return res.rowCount ?? 0;
}

export const JOBS = {
  "purge-expired-invitations": purgeExpiredInvitations,
  "purge-old-notifications": purgeOldNotifications,
} as const;
