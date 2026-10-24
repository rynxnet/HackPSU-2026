"use client";

import React, { useState } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FolderGit2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export function NewProjectModal() {
  const router = useRouter();
  const newProjectModalOpen = useWorkspaceStore((s) => s.newProjectModalOpen);
  const setNewProjectModalOpen = useWorkspaceStore((s) => s.setNewProjectModalOpen);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);

    try {
      const project = await api.createProject(name.trim(), description.trim());
      setNewProjectModalOpen(false);
      setName("");
      setDescription("");
      router.push(`/workspace/${project.id}`);
    } catch (err: any) {
      alert(`Failed to create project: ${err.message || "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={newProjectModalOpen} onOpenChange={setNewProjectModalOpen}>
      <DialogContent className="max-w-md bg-[#18181b] border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-primary" />
            <span>Create Research Project Repo</span>
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Each project functions as an isolated repo with dedicated `/library` papers, `/data` datasets, and vector embeddings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-2 text-xs">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
              Project Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Quantum Neural Architectures"
              autoFocus
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground mb-1 block">
              Description (Optional)
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Primary research goal or focus area"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNewProjectModalOpen(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={!name.trim() || loading}
            className="gap-1.5"
          >
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{loading ? "Creating..." : "Create Repo"}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
