"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

import { ChatMessage } from "@/lib/types";
import { CitationBadge } from "./CitationBadge";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { answerSnippet } from "@/lib/citations";
import { Sparkles, User, Terminal, CheckCircle2, FileInput } from "lucide-react";

function InsertAnswerButton({ message }: { message: ChatMessage }) {
  const bibliography = useWorkspaceStore((s) => s.bibliography);
  const insertIntoDraft = useWorkspaceStore((s) => s.insertIntoDraft);
  const draftTarget = useWorkspaceStore((s) => s.draftTarget);

  return (
    <button
      onClick={() => insertIntoDraft(answerSnippet(message.content, message.citations || [], bibliography), "Answer")}
      className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary transition-colors"
      title={draftTarget ? `Insert at the cursor in ${draftTarget.title}, with citations converted to citation keys` : "Open a draft to insert this answer"}
    >
      <FileInput className="w-3 h-3" />
      <span>Insert into {draftTarget ? draftTarget.title : "draft"}</span>
    </button>
  );
}

interface ChatMessageListProps {
  messages: ChatMessage[];
  streamingToken?: string;
  isThinking?: boolean;
}

export function ChatMessageList({ messages, streamingToken, isThinking }: ChatMessageListProps) {
  // Keep the newest message in view as answers stream in
  const endRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, streamingToken, isThinking]);

  return (
    <div className="flex-1 p-3 space-y-4 overflow-y-auto text-xs leading-relaxed">
      {messages.length === 0 && !streamingToken && (
        <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground select-none">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary mb-2">
            <Sparkles className="w-4 h-4" />
          </div>
          <p className="font-medium text-foreground text-xs">ResearchIDE Grounded Agent</p>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
            Ask any question across your project's papers (<span className="text-primary font-mono">/library</span>) and datasets (<span className="text-emerald-400 font-mono">/data</span>). Answers are strictly grounded with citations.
          </p>
        </div>
      )}

      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          {msg.role === "assistant" && (
            <div className="w-5 h-5 rounded bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
              <Sparkles className="w-3 h-3" />
            </div>
          )}

          <div
            className={`max-w-[88%] rounded-lg p-2.5 space-y-2 ${
              msg.role === "user"
                ? "bg-primary text-primary-foreground font-sans text-xs"
                : "bg-[#18181b] border border-border/80 text-foreground"
            }`}
          >
            {/* Message Body */}
            <div className="prose prose-invert prose-xs max-w-none text-xs break-words select-text">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                  code: ({ children }) => (
                    <code className="bg-black/40 px-1 py-0.5 rounded text-[11px] font-mono text-sky-300">
                      {children}
                    </code>
                  ),
                }}
              >
                {msg.content}
              </ReactMarkdown>
            </div>

            {msg.role === "assistant" && !msg.content.startsWith("⚠️") && (
              <InsertAnswerButton message={msg} />
            )}

            {/* Citations Footer Shelf */}
            {msg.citations && msg.citations.length > 0 && (
              <div className="pt-2 border-t border-border/50">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-1 flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                  Grounded Citations ({msg.citations.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {msg.citations.map((cite, idx) => (
                    <CitationBadge key={idx} citation={cite} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {msg.role === "user" && (
            <div className="w-5 h-5 rounded bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
              <User className="w-3 h-3" />
            </div>
          )}
        </div>
      ))}

      {isThinking && !streamingToken && (
        <div className="flex gap-2.5 justify-start">
          <div className="w-5 h-5 rounded bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-3 h-3 animate-pulse" />
          </div>
          <div className="rounded-lg px-2.5 py-2 bg-[#18181b] border border-border/80 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1 h-1 rounded-full bg-primary animate-bounce" />
            </span>
            Searching your library...
          </div>
        </div>
      )}

      {/* Streaming assistant token bubble */}
      {streamingToken && (
        <div className="flex gap-2.5 justify-start">
          <div className="w-5 h-5 rounded bg-primary/20 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <Sparkles className="w-3 h-3 animate-pulse" />
          </div>
          <div className="max-w-[88%] rounded-lg p-2.5 bg-[#18181b] border border-border/80 text-foreground text-xs leading-relaxed">
            <div className="prose prose-invert prose-xs max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {streamingToken}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
