/** A role's playbook — the professional standard an employee follows. Pure data, one file per role, he + en. */
export interface PlaybookText {
  mission: string;
  kpis: string[];
  sop: string[];
  standards: string[];
  templates: string[];
  forbidden: string[];
  checklist: string[];
  good: string;
  bad: string;
  escalation: string[];
}
export interface Playbook {
  role: string;
  version: number;
  he: PlaybookText;
  en: PlaybookText;
}
