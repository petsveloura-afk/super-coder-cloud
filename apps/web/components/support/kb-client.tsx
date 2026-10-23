"use client";

import { BookOpen, Plus } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { ConfirmActionButton, FormDialog } from "@/components/ui/form-dialog";
import { deleteArticleAction, saveArticleAction } from "@/app/[locale]/(dashboard)/support/kb-actions";

export interface ArticleRow {
  id: string;
  title: string;
  body: string;
  category: string | null;
  published: boolean;
  views: number;
  helpful: number;
}

/** Wave 16 — create / edit a knowledge-base article. */
export function ArticleDialog({ article }: { article?: ArticleRow }) {
  const { t } = useI18n();
  return (
    <FormDialog
      action={saveArticleAction}
      title={t(article ? "kb.edit" : "kb.new")}
      hidden={{ id: article?.id }}
      className="sm:max-w-2xl"
      trigger={
        article ? (
          <Button size="sm" variant="ghost">
            {t("common.edit")}
          </Button>
        ) : (
          <Button data-testid="kb-new">
            <Plus className="h-4 w-4" /> {t("kb.new")}
          </Button>
        )
      }
    >
      {(state) => (
        <>
          <Field label={t("kb.articleTitle")} htmlFor="kb-title" error={state.fieldErrors?.title ? t(state.fieldErrors.title) : undefined}>
            <Input id="kb-title" name="title" defaultValue={state.values?.title ?? article?.title ?? ""} placeholder={t("kb.titlePlaceholder")} />
          </Field>
          <Field label={t("kb.category")} htmlFor="kb-cat">
            <Input id="kb-cat" name="category" defaultValue={state.values?.category ?? article?.category ?? ""} placeholder={t("kb.categoryPlaceholder")} />
          </Field>
          <Field label={t("kb.body")} htmlFor="kb-body" error={state.fieldErrors?.body ? t(state.fieldErrors.body) : undefined} hint={t("kb.bodyHint")}>
            <Textarea id="kb-body" name="body" rows={10} defaultValue={state.values?.body ?? article?.body ?? ""} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="published" defaultChecked={article ? article.published : true} className="h-4 w-4 accent-[var(--brand)]" /> {t("kb.published")}
          </label>
        </>
      )}
    </FormDialog>
  );
}

export function KbList({ articles, canWrite }: { articles: ArticleRow[]; canWrite: boolean }) {
  const { t } = useI18n();
  if (!articles.length) return <p className="p-8 text-center text-sm text-subtle">{t("kb.empty")}</p>;
  return (
    <ul className="divide-y divide-line" data-testid="kb-list">
      {articles.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
          <BookOpen className="h-4 w-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{a.title}</p>
            <p className="truncate text-[12px] text-muted">
              {a.category ? `${a.category} · ` : ""}
              {t("kb.stats", { views: a.views, helpful: a.helpful })}
              {!a.published ? ` · ${t("kb.draft")}` : ""}
            </p>
          </div>
          {canWrite ? (
            <>
              <ArticleDialog article={a} />
              <ConfirmActionButton action={deleteArticleAction} fields={{ id: a.id }} variant="ghost" size="sm" />
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
