"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Upload } from "lucide-react";
import { toast } from "sonner";
import { csvToImportRows, parseCsv, type ImportColumn } from "@scc/shared/validators";
import { useI18n } from "@/lib/i18n/client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/primitives";
import { importContactsAction, type ImportResult } from "@/app/[locale]/(dashboard)/crm/suite-actions";

const CHUNK = 1000;
const MAX_ROWS = 20000;
const MAX_BYTES = 5 * 1024 * 1024;

/** CSV import: parse in the browser, preview, then send in chunks; the DB re-validates every row. */
export function ImportContactsDialog() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [columns, setColumns] = useState<(ImportColumn | null)[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [records, setRecords] = useState<Record<string, string | boolean>[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);

  function reset() {
    setFileName("");
    setColumns([]);
    setHeaders([]);
    setRecords([]);
    setError(null);
    setProgress(0);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    if (file.size > MAX_BYTES) return setError(t("import.fileTooBig"));
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) return setError(t("import.empty"));
    const parsed = csvToImportRows(rows);
    if (!parsed.columns.includes("first_name") && !parsed.columns.includes("email") && !parsed.columns.includes("phone")) {
      return setError(t("import.noColumns"));
    }
    if (parsed.records.length > MAX_ROWS) return setError(t("import.tooManyRows", { max: MAX_ROWS }));
    setFileName(file.name);
    setHeaders(rows[0] ?? []);
    setColumns(parsed.columns);
    setRecords(parsed.records as Record<string, string | boolean>[]);
  }

  async function run() {
    setBusy(true);
    setError(null);
    const total: ImportResult = { inserted: 0, skipped: 0, invalid: 0, errors: [] };
    try {
      for (let i = 0; i < records.length; i += CHUNK) {
        const res = await importContactsAction({ locale, rows: records.slice(i, i + CHUNK), offset: i });
        if (res.error || !res.data) {
          setError(t(res.error ?? "errors.generic"));
          break;
        }
        total.inserted += res.data.inserted;
        total.skipped += res.data.skipped;
        total.invalid += res.data.invalid;
        total.errors.push(...res.data.errors);
        setProgress(Math.min(records.length, i + CHUNK));
      }
      setResult(total);
      if (total.inserted) toast.success(t("import.done", { count: total.inserted }));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const mapped = columns.filter(Boolean).length;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
      title={t("import.title")}
      description={t("import.hint")}
      className="sm:max-w-2xl"
      trigger={
        <Button variant="secondary">
          <Upload className="h-4 w-4" /> {t("import.button")}
        </Button>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line px-4 py-8 text-center hover:border-accent hover:bg-surface-hover">
          <FileUp className="h-7 w-7 text-accent" />
          <span className="text-sm font-medium">{fileName || t("import.choose")}</span>
          <span className="text-[12px] text-subtle">{t("import.formats")}</span>
          <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="sr-only" aria-label={t("import.choose")} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>

        {error ? (
          <p role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        {records.length > 0 && !result ? (
          <>
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t("import.mapping", { mapped, total: headers.length })}</h3>
              <ul className="flex flex-wrap gap-1.5">
                {headers.map((h, i) => (
                  <li key={`${h}-${i}`} className={`rounded-lg border px-2.5 py-1 text-[12px] ${columns[i] ? "border-accent/40 bg-accent-soft text-accent" : "border-line text-subtle line-through"}`}>
                    {h || "—"} {columns[i] ? `→ ${t(`import.columns.${columns[i]}`)}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full text-start text-[12.5px]">
                <thead className="bg-elevated text-subtle">
                  <tr>
                    {(["first_name", "last_name", "email", "phone", "company_name"] as const).map((c) => (
                      <th key={c} className="px-3 py-2 text-start font-medium">
                        {t(`import.columns.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {records.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      {(["first_name", "last_name", "email", "phone", "company_name"] as const).map((c) => (
                        <td key={c} className="max-w-[160px] truncate px-3 py-2">
                          {String(r[c] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-muted">{busy ? t("import.progress", { done: progress, total: records.length }) : t("import.ready", { count: records.length })}</span>
              <Button onClick={run} loading={busy}>
                {t("import.start", { count: records.length })}
              </Button>
            </div>
          </>
        ) : null}

        {result ? (
          <div role="status" className="space-y-2 rounded-xl border border-line bg-elevated p-4 text-sm">
            <p className="font-semibold">{t("import.summary", { inserted: result.inserted, skipped: result.skipped, invalid: result.invalid })}</p>
            {result.errors.length ? (
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-[12.5px] text-muted">
                {result.errors.slice(0, 50).map((e) => (
                  <li key={`${e.row}-${e.reason}`}>{t(`import.reason_${e.reason}`, { row: e.row + 1 })}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
