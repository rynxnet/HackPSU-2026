"use client";

import React, { useState, useRef, useEffect } from "react";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { ArrowUp, CornerDownLeft, Sparkles } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (content: string) => void;
  isLoading: boolean;
}

export function ChatInput({ onSendMessage, isLoading }: ChatInputProps) {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatFocusTrigger = useWorkspaceStore((s) => s.chatFocusTrigger);

  // Auto focus on Cmd+K
  useEffect(() => {
    if (chatFocusTrigger > 0 && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [chatFocusTrigger]);

  const handleSubmit = () => {
    if (!input.trim() || isLoading) return;
    onSendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="p-3 border-t border-border bg-[#141416]">
      <div className="relative rounded-lg border border-border bg-[#18181b] focus-within:border-primary/60 transition-colors shadow-sm">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask grounded questions across project papers & data... (Cmd+K)"
          rows={3}
          className="w-full resize-none bg-transparent p-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
        />

        <div className="flex items-center justify-between px-2.5 py-1.5 border-t border-border/40 text-[10px] text-muted-foreground select-none">
          <span className="flex items-center gap-1 font-mono">
            <span>Enter ↵ to send</span>
            <span>•</span>
            <span>Shift+Enter for newline</span>
          </span>

          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="h-6 w-6 rounded bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:bg-primary/90 transition-opacity"
            title="Send query"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
