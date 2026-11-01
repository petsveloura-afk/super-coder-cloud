"use client";

import { ModuleError } from "@/components/ui/module-states";

export default function ModuleErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ModuleError error={error} reset={reset} module="team" />;
}
