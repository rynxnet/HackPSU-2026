"use client";

import React, { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Paper } from "@/lib/types";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { findEntry, citeSnippet, quoteSnippet } from "@/lib/citations";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Quote,
  TextCursorInput,
  FileText,
  Bookmark,
  ExternalLink,
  ChevronRight,
  Loader2,
  ZoomIn,
  ZoomOut,
  Download,
} from "lucide-react";

interface PDFViewerPaneProps {
  paperId: string;
  initialPage?: number;
  initialSectionTitle?: string;
}

export function PDFViewerPane({ paperId, initialPage = 1, initialSectionTitle }: PDFViewerPaneProps) {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [activeTab, setActiveTab] = useState<"pdf" | "sections">("pdf");
  const [selectedSection, setSelectedSection] = useState<string | null>(initialSectionTitle || null);

  useEffect(() => {
    api.getPaperDetails(paperId)
      .then((data) => {
        setPaper(data);
        if (initialSectionTitle) {
          const match = data.sections?.find((s) => s.section_title.toLowerCase().includes(initialSectionTitle.toLowerCase()));
          if (match && match.start_page) {
            setCurrentPage(match.start_page);
          }
        }
      })
      .catch((err) => console.error("Error loading paper details:", err));
  }, [paperId, initialSectionTitle]);

  const pdfUrl = api.getPaperPdfUrl(paperId);

  const bibliography = useWorkspaceStore((s) => s.bibliography);
  const insertIntoDraft = useWorkspaceStore((s) => s.insertIntoDraft);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [selection, setSelection] = useState<{ text: string; page?: number; x: number; y: number } | null>(null);
  const readerRef = useRef<HTMLDivElement>(null);

  // Clear the floating "quote" button whenever the selection collapses
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setSelection(null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);

  const handleSelection = (e: React.MouseEvent, page?: number) => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() || "";
    if (!sel || !text || sel.rangeCount === 0 || !readerRef.current) {
      setSelection(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const host = readerRef.current.getBoundingClientRect();
    setSelection({
      text,
      page,
      x: rect.left - host.left + rect.width / 2 + readerRef.current.scrollLeft,
      y: rect.top - host.top + readerRef.current.scrollTop,
    });
  };

  const insertSelection = (asQuote: boolean) => {
    if (!selection || !paper) return;
    const entry = findEntry(bibliography, { paper_id: paper.id, paper_title: paper.title });
    if (!entry) {
      pushToast("This paper isn't in the bibliography yet. Try again in a moment.", "error");
      return;
    }
    const inserted = insertIntoDraft(
      asQuote ? quoteSnippet(entry, selection.text, selection.page) : citeSnippet(entry, selection.page),
      asQuote ? "Quote" : "Citation"
    );
    if (inserted) {
      window.getSelection()?.removeAllRanges();
      setSelection(null);
    }
  };

  if (!paper) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Loading academic paper...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#121214] overflow-hidden">
      {/* Paper Header / Metadata Bar */}
      <div className="border-b border-border bg-[#18181b] px-3 py-2 flex items-center justify-between text-xs select-none">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Bookmark className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <div className="truncate">
            <span className="font-semibold text-foreground mr-2">{paper.title}</span>
            {paper.year && <span className="text-muted-foreground">({paper.year})</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="flex rounded border border-border p-0.5 bg-background/50">
            <button
              onClick={() => setActiveTab("pdf")}
              className={`px-2 py-0.5 rounded text-[11px] ${
                activeTab === "pdf" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              PDF Viewer
            </button>
            <button
              onClick={() => setActiveTab("sections")}
              className={`px-2 py-0.5 rounded text-[11px] ${
                activeTab === "sections" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground"
              }`}
            >
              Extracted Sections ({paper.sections?.length || 0})
            </button>
          </div>

          <button
            onClick={() => {
              const entry = findEntry(bibliography, { paper_id: paper.id, paper_title: paper.title });
              if (entry) insertIntoDraft(citeSnippet(entry), "Citation");
              else pushToast("This paper isn't in the bibliography yet.", "error");
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Insert a citation to this paper at the cursor in your draft"
          >
            <TextCursorInput className="w-3 h-3" />
            Cite
          </button>

          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            download={`${paper.title}.pdf`}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Download PDF"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Main View Area */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === "pdf" ? (
          <div className="flex-1 h-full bg-[#1e1e20]">
            <iframe
              src={`${pdfUrl}#page=${currentPage}`}
              className="w-full h-full border-0"
              title={paper.title}
            />
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Sections List */}
            <div className="w-72 border-r border-border bg-[#141416] flex flex-col">
              <div className="p-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                Table of Contents
              </div>
              <ScrollArea className="flex-1">
                <div className="p-1 space-y-0.5 text-xs">
                  {paper.sections?.map((sec) => (
                    <button
                      key={sec.id}
                      onClick={() => {
                        setSelectedSection(sec.section_title);
                        if (sec.start_page) setCurrentPage(sec.start_page);
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded flex items-center justify-between text-xs transition-colors ${
                        selectedSection === sec.section_title
                          ? "bg-primary/15 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      }`}
                    >
                      <span className="truncate flex-1">{sec.section_title}</span>
                      {sec.start_page && (
                        <span className="text-[10px] text-muted-foreground/60 font-mono ml-2">
                          p.{sec.start_page}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Section Reader Content */}
            <div ref={readerRef} className="flex-1 bg-background p-6 overflow-y-auto relative">
              {selection && (
                <div
                  className="absolute z-20 -translate-x-1/2 -translate-y-full flex items-center gap-0.5 rounded-md border border-border bg-[#202024] shadow-lg p-0.5 text-[11px]"
                  style={{ left: selection.x, top: selection.y - 6 }}
                  onMouseDown={(e) => e.preventDefault()} // keep the text selected while clicking
                >
                  <button
                    onClick={() => insertSelection(true)}
                    className="flex items-center gap-1 px-2 py-1 rounded hover:bg-primary/20 text-foreground"
                  >
                    <Quote className="w-3 h-3 text-primary" />
                    Quote in draft
                  </button>
                  <button
                    onClick={() => insertSelection(false)}
                    className="flex items-center gap-1 px-2 py-1 rounded hover:bg-primary/20 text-muted-foreground"
                  >
                    <TextCursorInput className="w-3 h-3" />
                    Cite only
                  </button>
                </div>
              )}
              {paper.sections?.find((s) => s.section_title === selectedSection) ? (
                (() => {
                  const sec = paper.sections.find((s) => s.section_title === selectedSection)!;
                  return (
                    <div className="max-w-3xl mx-auto space-y-4">
                      <div className="flex items-center justify-between border-b border-border pb-2 gap-3">
                        <h2 className="text-xl font-bold tracking-tight text-white">
                          {sec.section_title}
                        </h2>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          Select text to quote it in your draft
                        </span>
                      </div>
                      <div
                        onMouseUp={(e) => handleSelection(e, sec.start_page)}
                        className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap font-sans select-text selection:bg-primary/40 selection:text-white"
                      >
                        {sec.content}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div className="max-w-3xl mx-auto space-y-4">
                  <h1 className="text-2xl font-bold text-white">{paper.title}</h1>
                  {paper.authors && paper.authors.length > 0 && (
                    <div className="text-sm text-primary">
                      {paper.authors.map((a) => a.name).join(", ")}
                    </div>
                  )}
                  {paper.abstract && (
                    <div className="p-4 rounded-lg bg-card border border-border space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Abstract
                      </h3>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {paper.abstract}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
