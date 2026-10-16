"use client";

import { Printer } from "lucide-react";

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#3366E6] px-4 text-sm font-medium text-white print:hidden">
      <Printer className="h-4 w-4" /> {label}
    </button>
  );
}
