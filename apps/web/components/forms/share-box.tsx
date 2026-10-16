"use client";

import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n/client";
import { Button } from "@/components/ui/primitives";

/** Public link + iframe embed snippet with copy buttons. */
export function ShareBox({ url, height = 640 }: { url: string; height?: number }) {
  const { t } = useI18n();
  const embed = `<iframe src="${url}" style="width:100%;max-width:640px;height:${height}px;border:0" loading="lazy" title="form"></iframe>`;
  const copy = async (v: string) => {
    await navigator.clipboard.writeText(v);
    toast.success(t("common.copied"));
  };
  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="text-[12.5px] text-muted">{t("forms.publicLink")}</span>
        <div className="mt-1 flex items-center gap-2">
          <code dir="ltr" className="min-w-0 flex-1 truncate rounded-lg bg-elevated px-3 py-2 text-[12.5px]" data-testid="public-url">
            {url}
          </code>
          <Button variant="secondary" size="sm" onClick={() => copy(url)}>
            <Copy className="h-4 w-4" /> {t("common.copy")}
          </Button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-hover" aria-label={t("forms.open")}>
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
      <div>
        <span className="text-[12.5px] text-muted">{t("forms.embedCode")}</span>
        <div className="mt-1 flex items-start gap-2">
          <code dir="ltr" className="min-w-0 flex-1 break-all rounded-lg bg-elevated px-3 py-2 text-[11.5px]">
            {embed}
          </code>
          <Button variant="secondary" size="sm" onClick={() => copy(embed)}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
