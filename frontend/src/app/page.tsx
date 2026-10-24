"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Project } from "@/lib/types";
import { Sparkles, FolderGit2, Plus, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewProjectModal } from "@/components/modals/NewProjectModal";
import { useWorkspaceStore } from "@/store/workspaceStore";

export default function HomePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const setNewProjectModalOpen = useWorkspaceStore((s) => s.setNewProjectModalOpen);

  useEffect(() => {
    api.getProjects()
      .then((data) => {
        setProjects(data);
        if (data && data.length > 0) {
          router.replace(`/workspace/${data[0].id}`);
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#141416] text-muted-foreground text-xs select-none">
        <Sparkles className="w-8 h-8 text-primary animate-pulse mb-3" />
        <span className="font-mono">Loading ResearchIDE...</span>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#141416] p-6 select-none">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 text-primary">
          <Sparkles className="w-6 h-6" />
        </div>

        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">ResearchIDE</h1>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            An IDE-style workspace for academic research. Each project houses your research library (papers), datasets, and drafts with Gemini-powered grounded citations.
          </p>
        </div>

        <div className="pt-2">
          <Button
            onClick={() => setNewProjectModalOpen(true)}
            size="lg"
            className="w-full gap-2 text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            <span>Create Your First Research Repo</span>
          </Button>
        </div>

        {projects.length > 0 && (
          <div className="pt-4 border-t border-border/60 text-left space-y-2">
            <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider block">
              Recent Repositories
            </span>
            {projects.map((p) => (
              <div
                key={p.id}
                onClick={() => router.push(`/workspace/${p.id}`)}
                className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-[#18181b] hover:border-primary/50 cursor-pointer transition-colors text-xs"
              >
                <div className="flex items-center gap-2">
                  <FolderGit2 className="w-4 h-4 text-primary" />
                  <span className="font-medium text-foreground">{p.name}</span>
                </div>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
              </div>
            ))}
          </div>
        )}
      </div>

      <NewProjectModal />
    </div>
  );
}
