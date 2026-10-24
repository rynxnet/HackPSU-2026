"use client";

import React from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export function Toaster() {
  const toasts = useWorkspaceStore((s) => s.toasts);
  const dismissToast = useWorkspaceStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-[#202024] shadow-lg text-xs text-foreground max-w-md animate-in fade-in slide-in-from-bottom-2"
        >
          {t.kind === "success" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
          {t.kind === "error" && <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
          {t.kind === "info" && <Info className="w-3.5 h-3.5 text-sky-400 shrink-0" />}
          <span>{t.message}</span>
          <button onClick={() => dismissToast(t.id)} className="ml-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
