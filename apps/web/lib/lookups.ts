import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/** Options for <select> pickers. All queries run through RLS for the current user. */
export interface Option {
  id: string;
  label: string;
  sub?: string | null;
}

export const memberOptions = cache(async (orgId: string): Promise<Option[]> => {
  const supabase = await createClient();
  const { data: members } = await supabase.from("organization_members").select("user_id").eq("organization_id", orgId);
  const ids = (members ?? []).map((m) => m.user_id as string);
  if (!ids.length) return [];
  const { data: profiles } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  return (profiles ?? [])
    .map((p) => ({ id: p.id as string, label: (p.full_name as string | null) || (p.email as string | null) || "—", sub: p.email as string | null }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

export const contactOptions = cache(async (orgId: string, limit = 500): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, email, phone")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((c) => ({
    id: c.id as string,
    label: `${c.first_name} ${c.last_name}`.trim(),
    sub: (c.email as string | null) ?? (c.phone as string | null),
  }));
});

export const companyOptions = cache(async (orgId: string, limit = 500): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("companies").select("id, name, domain").eq("organization_id", orgId).order("name").limit(limit);
  return (data ?? []).map((c) => ({ id: c.id as string, label: c.name as string, sub: c.domain as string | null }));
});

export interface StageInfo {
  id: string;
  name: string;
  position: number;
  probability: number;
  pipeline_id: string;
  /** wave 15: business events that move deals into this stage automatically */
  auto_on?: string[];
  marks_won?: boolean;
}
export interface PipelineInfo {
  id: string;
  name: string;
  is_default: boolean;
  stages: StageInfo[];
}

export const pipelinesWithStages = cache(async (orgId: string): Promise<PipelineInfo[]> => {
  const supabase = await createClient();
  const [{ data: pipes }, stageRes] = await Promise.all([
    supabase.from("pipelines").select("id, name, is_default").eq("organization_id", orgId).order("created_at"),
    supabase.from("pipeline_stages").select("id, name, position, probability, pipeline_id, auto_on, marks_won").eq("organization_id", orgId).order("position"),
  ]);
  // before the wave-15 migration the new columns do not exist yet — read the classic ones
  const stages = stageRes.error
    ? (await supabase.from("pipeline_stages").select("id, name, position, probability, pipeline_id").eq("organization_id", orgId).order("position")).data
    : stageRes.data;
  return (pipes ?? [])
    .map((p) => ({
      id: p.id as string,
      name: p.name as string,
      is_default: Boolean(p.is_default),
      stages: ((stages ?? []) as StageInfo[]).filter((s) => s.pipeline_id === p.id),
    }))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default));
});
