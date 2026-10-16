import { Card, CardHeader } from "@/components/ui/primitives";
import { ChannelCard, type ChannelRow } from "@/components/integrations/channel-card";
import { createClient } from "@/lib/supabase/server";
import { publicEnv } from "@/lib/env";
import { getT } from "@/lib/i18n/server";
import { encryptionReady } from "@/lib/channels/secrets";
import type { Locale } from "@/lib/i18n/config";

/** Server component: WhatsApp / Telegram / SMS connection cards. */
export async function ChannelsSection({ orgId, locale = "he" }: { orgId: string; locale?: Locale }) {
  const supabase = await createClient();
  const { t } = await getT(locale);
  const { data } = await supabase
    .from("channel_accounts")
    .select("id, kind, name, status, config, webhook_token, last_error, last_inbound_at")
    .eq("organization_id", orgId);
  const rows = (data ?? []) as ChannelRow[];
  const base = publicEnv.appUrl.replace(/\/$/, "");
  return (
    <Card className="mb-4">
      <CardHeader title={t("integrations.channels.title")} description={t("integrations.channels.hint")} />
      <ul className="grid gap-3 p-4 lg:grid-cols-3">
        {(["whatsapp", "telegram", "sms"] as const).map((kind) => {
          const row = rows.find((r) => r.kind === kind) ?? null;
          return (
            <li key={kind}>
              <ChannelCard kind={kind} row={row} webhookUrl={row ? `${base}/api/channels/${kind}/${row.webhook_token}` : null} encryptionReady={encryptionReady()} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
