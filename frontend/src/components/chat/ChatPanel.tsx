"use client";

import React, { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useWorkspaceStore } from "@/store/workspaceStore";
import { api } from "@/lib/api";
import { ChatSession, ChatMessage } from "@/lib/types";
import { ChatMessageList } from "./ChatMessageList";
import { ChatInput } from "./ChatInput";
import {
  Sparkles,
  Plus,
  ChevronRight,
  ShieldCheck,
  History,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export function ChatPanel() {
  // The URL is the source of truth for the open project; the store can briefly
  // hold the previous project's id while navigating
  const params = useParams();
  const storeProjectId = useWorkspaceStore((s) => s.activeProjectId);
  const activeProjectId = (params?.projectId as string | undefined) ?? storeProjectId;
  const chatCollapsed = useWorkspaceStore((s) => s.chatCollapsed);
  const setChatCollapsed = useWorkspaceStore((s) => s.setChatCollapsed);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [streamingToken, setStreamingToken] = useState("");

  // Only the newest load may update state; responses can arrive out of order
  // while navigating between projects
  const loadSeq = useRef(0);

  const loadSessions = async () => {
    if (!activeProjectId) return;
    const seq = ++loadSeq.current;
    const isStale = () => seq !== loadSeq.current;
    try {
      const data = await api.getChatSessions(activeProjectId);
      if (isStale()) return;
      setSessions(data);
      if (data.length > 0) {
        const full = await api.getSessionDetails(data[0].id);
        if (isStale()) return;
        setCurrentSession(full);
        setMessages(full.messages || []);
      } else {
        // New project with no chats yet: don't keep showing the previous project's conversation
        setCurrentSession(null);
        setMessages([]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadSessions();
  }, [activeProjectId]);

  const handleNewSession = async () => {
    if (!activeProjectId) return;
    try {
      const sess = await api.createChatSession(activeProjectId, "Research Discussion");
      setSessions((prev) => [sess, ...prev]);
      setCurrentSession(sess);
      setMessages([]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendMessage = async (content: string) => {
    if (!activeProjectId) return;

    // Optimistically append user message
    const tempUserMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      session_id: currentSession?.id || "",
      role: "user",
      content,
      citations: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    setLoading(true);
    setStreamingToken("");

    try {
      // Stream the answer so it appears as Gemini writes it
      const projectId = activeProjectId;
      const res = await api.streamChatMessage(projectId, content, currentSession?.id, (soFar) => setStreamingToken(soFar));
      const assistantMsg: ChatMessage = {
        id: `local-${Date.now()}`,
        session_id: res.sessionId || currentSession?.id || "",
        role: "assistant",
        content: res.text,
        citations: res.citations,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingToken("");
      // Adopt the saved session so follow-up questions keep their context
      if (res.sessionId && res.sessionId !== currentSession?.id) {
        api.getSessionDetails(res.sessionId).then((s) => {
          if (useWorkspaceStore.getState().activeProjectId === projectId) setCurrentSession(s);
        }).catch(() => {});
      }
    } catch (err: any) {
      setStreamingToken("");
      console.error("Chat error:", err);
      const errorMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        session_id: currentSession?.id || "",
        role: "assistant",
        content: `Error: ${err.message || "Failed to contact Gemini research agent"}`,
        citations: [],
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  if (chatCollapsed) {
    return (
      <div className="w-9 border-l border-border bg-[#141416] flex flex-col items-center py-2 select-none">
        <button
          onClick={() => setChatCollapsed(false)}
          className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-white"
          title="Expand Chat (Cmd+K)"
        >
          <Sparkles className="w-4 h-4 text-primary" />
        </button>
      </div>
    );
  }

  return (
    <aside className="w-80 sm:w-96 border-l border-border bg-[#141416] flex flex-col select-none shrink-0">
      {/* Header */}
      <div className="h-9 border-b border-border bg-[#18181b] px-3 flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span>Research Agent</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-mono flex items-center gap-1">
            <ShieldCheck className="w-2.5 h-2.5" />
            Grounded
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleNewSession}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="New Chat Session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setChatCollapsed(true)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Collapse Chat"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages Scroll Area */}
      <ChatMessageList messages={messages} streamingToken={streamingToken} isThinking={loading} />

      {/* Input */}
      <ChatInput onSendMessage={handleSendMessage} isLoading={loading} />
    </aside>
  );
}
