"use client";

import Link from "next/link";
import { GitMerge } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { ConfirmActionButton } from "@/components/ui/form-dialog";
import { Ltr } from "@/components/ui/primitives";
import { formatDate, formatPhone } from "@/lib/format";
import { mergeContactsAction } from "@/app/[locale]/(dashboard)/crm/suite-actions";

export interface DuplicateRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
}

/** Possible duplicates of the open contact; merging keeps THIS contact and absorbs the other. */
export function DuplicatesList({ contactId, rows }: { contactId: string; rows: DuplicateRow[] }) {
  const { t, locale } = useI18n();
  return (
    <ul className="divide-y divide-line">
      {rows.map((d) => (
        <li key={d.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Link href={`/${locale}/crm/${d.id}`} className="font-medium hover:text-accent">
              {d.first_name} {d.last_name}
            </Link>
            <div className="text-[12.5px] text-muted">
              {d.email ? <Ltr>{d.email}</Ltr> : null}
              {d.email && d.phone ? " · " : null}
              {d.phone ? <Ltr>{formatPhone(d.phone)}</Ltr> : null}
              {" · "}
              {formatDate(locale, d.created_at)}
            </div>
          </div>
          <ConfirmActionButton
            action={mergeContactsAction}
            fields={{ keepId: contactId, mergeId: d.id }}
            variant="secondary"
            size="sm"
            icon={<GitMerge className="h-4 w-4" />}
            label={t("merge.mergeInto")}
            confirm={t("merge.confirm", { name: `${d.first_name} ${d.last_name}`.trim() })}
          />
        </li>
      ))}
    </ul>
  );
}
