"use client";

import React, { useState } from "react";
import { useDropzone } from "react-dropzone";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { UploadCloud, FileText, Database, Check, Loader2, X } from "lucide-react";

export function UploadModal() {
  const uploadModalOpen = useWorkspaceStore((s) => s.uploadModalOpen);
  const setUploadModalOpen = useWorkspaceStore((s) => s.setUploadModalOpen);
  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const refreshTree = useWorkspaceStore((s) => s.refreshTree);
  const pushToast = useWorkspaceStore((s) => s.pushToast);

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const onDrop = (accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted]);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "text/csv": [".csv"],
      "application/vnd.apache.parquet": [".parquet"],
      "text/tab-separated-values": [".tsv"],
    },
  });

  const handleUpload = async () => {
    if (!activeProjectId || files.length === 0) return;
    setUploading(true);
    setUploadProgress("Uploading files...");

    try {
      const pdfs = files.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
      const datasets = files.filter((f) => !f.name.toLowerCase().endsWith(".pdf"));

      if (pdfs.length > 0) {
        setUploadProgress(`Uploading and parsing ${pdfs.length} academic PDF(s)...`);
        await api.uploadPapers(activeProjectId, pdfs);
      }

      for (const ds of datasets) {
        setUploadProgress(`Ingesting dataset ${ds.name}...`);
        await api.uploadDataset(activeProjectId, ds);
      }

      setUploadModalOpen(false);
      setFiles([]);
      // Refresh the explorer in place so open tabs and drafts are kept
      refreshTree();
      pushToast(
        pdfs.length > 0
          ? `Uploaded ${files.length} file(s). Papers are being parsed and indexed; they become citable in a few seconds.`
          : `Uploaded ${files.length} file(s).`,
        "success"
      );
    } catch (err: any) {
      pushToast(`Upload error: ${err.message || "Failed to upload"}`, "error");
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
      <DialogContent className="max-w-md bg-[#18181b] border-border">
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold">Upload Research Materials</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Drop academic papers (.pdf) for GROBID extraction & vectorization, or datasets (.csv, .parquet).
          </DialogDescription>
        </DialogHeader>

        {/* Drop Area */}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            isDragActive ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"
          }`}
        >
          <input {...getInputProps()} />
          <UploadCloud className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-xs font-medium text-foreground">
            Drag & drop PDFs or datasets here, or click to browse
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Supports bulk PDF uploads, CSV, Parquet, and TSV
          </p>
        </div>

        {/* File Queue List */}
        {files.length > 0 && (
          <div className="max-h-36 overflow-y-auto space-y-1 my-2">
            {files.map((file, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-1.5 rounded bg-card border border-border text-xs"
              >
                <div className="flex items-center gap-2 truncate">
                  {file.name.endsWith(".pdf") ? (
                    <FileText className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Database className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )}
                  <span className="truncate text-[11px]">{file.name}</span>
                </div>
                <button
                  onClick={() => removeFile(idx)}
                  className="p-1 hover:text-destructive"
                  disabled={uploading}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <span className="text-[11px] text-muted-foreground">
            {uploadProgress || `${files.length} file(s) selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploadModalOpen(false)}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleUpload}
              disabled={files.length === 0 || uploading}
              className="gap-1.5"
            >
              {uploading && <Loader2 className="w-3 h-3 animate-spin" />}
              <span>{uploading ? "Ingesting..." : "Ingest Files"}</span>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
