import {
  Project, Paper, Dataset, Draft, ChatSession, ChatMessage, SearchResultItem, FileTreeItem,
  BibEntry, ExportTemplate, DraftVersion, ReviewComment, Figure, FigureSpec, ProblemsResponse,
  LiteratureMatrix, MatrixColumn, DraftSnippet,
} from "./types";

// Always use relative path so Next.js rewrites proxy requests to backend inside docker
const API_BASE = "";

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}/api/v1${endpoint}`;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: "include", // for session cookies
  });

  if (!response.ok) {
    let errMsg = `Request failed: ${response.statusText}`;
    try {
      const errJson = await response.json();
      errMsg = errJson.detail || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export const api = {
  // Projects
  async getProjects(): Promise<Project[]> {
    return request<Project[]>("/projects");
  },
  async getProject(id: string): Promise<Project> {
    return request<Project>(`/projects/${id}`);
  },
  async createProject(name: string, description?: string): Promise<Project> {
    return request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify({ name, description }),
    });
  },
  async getProjectTree(id: string): Promise<{ project_id: string; project_name: string; tree: FileTreeItem[] }> {
    return request(`/projects/${id}/tree`);
  },

  // Papers
  async uploadPapers(projectId: string, files: File[]): Promise<Paper[]> {
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));

    const response = await fetch(`/api/v1/projects/${projectId}/papers/upload`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to upload papers");
    return response.json();
  },
  async importDoiOrArxiv(projectId: string, identifier: string): Promise<Paper> {
    return request<Paper>(`/projects/${projectId}/papers/import-doi`, {
      method: "POST",
      body: JSON.stringify({ identifier }),
    });
  },
  async getPaperDetails(paperId: string): Promise<Paper> {
    return request<Paper>(`/papers/${paperId}`);
  },
  getPaperPdfUrl(paperId: string): string {
    return `/api/v1/papers/${paperId}/pdf`;
  },

  // Datasets
  async uploadDataset(projectId: string, file: File): Promise<Dataset> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/v1/projects/${projectId}/datasets/upload`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to upload dataset");
    return response.json();
  },
  async getDataset(datasetId: string): Promise<Dataset> {
    return request<Dataset>(`/datasets/${datasetId}`);
  },
  async getDatasetPreview(datasetId: string, page = 1, pageSize = 50) {
    return request<{ columns: string[]; rows: any[]; total_rows: number; page: number; page_size: number }>(
      `/datasets/${datasetId}/preview?page=${page}&page_size=${pageSize}`
    );
  },

  // Drafts
  async getDrafts(projectId: string): Promise<Draft[]> {
    return request<Draft[]>(`/projects/${projectId}/drafts`);
  },
  async getDraft(draftId: string): Promise<Draft> {
    return request<Draft>(`/drafts/${draftId}`);
  },
  async createDraft(projectId: string, title: string, content_type = "markdown", content = ""): Promise<Draft> {
    return request<Draft>(`/projects/${projectId}/drafts`, {
      method: "POST",
      body: JSON.stringify({ title, content_type, content }),
    });
  },
  async updateDraft(draftId: string, updates: Partial<{ title: string; content: string; content_type: string }>): Promise<Draft> {
    return request<Draft>(`/drafts/${draftId}`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
  },

  // Chat
  async getChatSessions(projectId: string): Promise<ChatSession[]> {
    return request<ChatSession[]>(`/projects/${projectId}/chat/sessions`);
  },
  async createChatSession(projectId: string, title = "New Chat"): Promise<ChatSession> {
    return request<ChatSession>(`/projects/${projectId}/chat/sessions?title=${encodeURIComponent(title)}`, {
      method: "POST",
    });
  },
  async getSessionDetails(sessionId: string): Promise<ChatSession> {
    return request<ChatSession>(`/chat/sessions/${sessionId}`);
  },
  async sendChatMessage(projectId: string, content: string, sessionId?: string): Promise<ChatMessage> {
    return request<ChatMessage>(`/projects/${projectId}/chat/message`, {
      method: "POST",
      body: JSON.stringify({ content, session_id: sessionId }),
    });
  },

  /**
   * Streams a grounded answer token by token (Server-Sent Events).
   * Resolves with the full text, citations and the session the reply was saved to.
   */
  async streamChatMessage(
    projectId: string,
    content: string,
    sessionId: string | undefined,
    onToken: (textSoFar: string) => void
  ): Promise<{ text: string; citations: ChatMessage["citations"]; sessionId?: string }> {
    const response = await fetch(`/api/v1/projects/${projectId}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, session_id: sessionId }),
      credentials: "include",
    });
    if (!response.ok || !response.body) throw new Error(await errorDetail(response, "Failed to contact the research agent"));

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let citations: ChatMessage["citations"] = [];
    let savedSession: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() || "";
      for (const evt of events) {
        const data = evt.replace(/^data: /, "").trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.type === "token") {
            text += parsed.text;
            onToken(text);
          } else if (parsed.type === "citations") {
            citations = parsed.citations || [];
          } else if (parsed.type === "session") {
            savedSession = parsed.session_id;
          }
        } catch {
          // ignore partial / malformed events
        }
      }
    }
    return { text, citations, sessionId: savedSession };
  },

  // Global Search
  async searchProject(projectId: string, query: string): Promise<{ query: string; results: SearchResultItem[] }> {
    return request(`/projects/${projectId}/search?q=${encodeURIComponent(query)}`);
  },

  // Bibliography & export
  async getBibliography(projectId: string): Promise<BibEntry[]> {
    const res = await request<{ entries: BibEntry[] }>(`/projects/${projectId}/bibliography`);
    return res.entries;
  },
  async downloadBibtex(projectId: string): Promise<void> {
    await downloadFile(`/projects/${projectId}/bibliography.bib`);
  },
  async getExportTemplates(): Promise<ExportTemplate[]> {
    return request<ExportTemplate[]>("/export/templates");
  },
  async exportDraft(draftId: string, template: string): Promise<void> {
    await downloadFile(`/drafts/${draftId}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template }),
    });
  },

  // Problems panel ("linter" for the manuscript)
  async getProblems(draftId: string): Promise<ProblemsResponse> {
    return request<ProblemsResponse>(`/drafts/${draftId}/problems`);
  },
  async runAudit(draftId: string): Promise<ProblemsResponse> {
    return request<ProblemsResponse>(`/drafts/${draftId}/audit`, { method: "POST" });
  },

  // Literature matrix
  async createMatrix(projectId: string, name: string, columns: MatrixColumn[]): Promise<LiteratureMatrix> {
    return request<LiteratureMatrix>(`/projects/${projectId}/matrices`, { method: "POST", body: JSON.stringify({ name, columns }) });
  },
  async getMatrix(matrixId: string): Promise<LiteratureMatrix> {
    return request<LiteratureMatrix>(`/matrices/${matrixId}`);
  },
  async updateMatrix(matrixId: string, updates: { name?: string; columns?: MatrixColumn[] }): Promise<LiteratureMatrix> {
    return request<LiteratureMatrix>(`/matrices/${matrixId}`, { method: "PATCH", body: JSON.stringify(updates) });
  },
  async fillMatrix(matrixId: string, columns?: string[], onlyEmpty = true): Promise<LiteratureMatrix> {
    return request<LiteratureMatrix>(`/matrices/${matrixId}/fill`, { method: "POST", body: JSON.stringify({ columns, only_empty: onlyEmpty }) });
  },
  async updateMatrixCell(matrixId: string, paperId: string, column: string, value: string | null): Promise<void> {
    await request(`/matrices/${matrixId}/cells`, { method: "PATCH", body: JSON.stringify({ paper_id: paperId, column, value }) });
  },
  async matrixToDataset(matrixId: string): Promise<{ dataset_id: string; name: string; rows: number; figures_updated: number }> {
    return request(`/matrices/${matrixId}/dataset`, { method: "POST" });
  },
  async matrixTable(matrixId: string): Promise<DraftSnippet> {
    return request<DraftSnippet>(`/matrices/${matrixId}/table`);
  },
  async deleteMatrix(matrixId: string): Promise<void> {
    await request(`/matrices/${matrixId}`, { method: "DELETE" });
  },

  // Draft version history
  async getDraftVersions(draftId: string): Promise<DraftVersion[]> {
    return request<DraftVersion[]>(`/drafts/${draftId}/versions`);
  },
  async saveDraftVersion(draftId: string, label?: string): Promise<DraftVersion> {
    return request<DraftVersion>(`/drafts/${draftId}/versions`, { method: "POST", body: JSON.stringify({ label }) });
  },
  async getDraftVersion(versionId: string): Promise<DraftVersion> {
    return request<DraftVersion>(`/draft-versions/${versionId}`);
  },
  async restoreDraftVersion(versionId: string): Promise<Draft> {
    return request<Draft>(`/draft-versions/${versionId}/restore`, { method: "POST" });
  },

  // Peer review
  async getReviewComments(draftId: string): Promise<ReviewComment[]> {
    return request<ReviewComment[]>(`/drafts/${draftId}/comments`);
  },
  async addReviewComment(draftId: string, comment: { body: string; reviewer?: string; anchor_text?: string }): Promise<ReviewComment> {
    return request<ReviewComment>(`/drafts/${draftId}/comments`, { method: "POST", body: JSON.stringify(comment) });
  },
  async importReviewComments(draftId: string, text: string, reviewer?: string): Promise<ReviewComment[]> {
    return request<ReviewComment[]>(`/drafts/${draftId}/comments/import`, { method: "POST", body: JSON.stringify({ text, reviewer }) });
  },
  async updateReviewComment(commentId: string, updates: Partial<Pick<ReviewComment, "body" | "reviewer" | "anchor_text" | "status" | "response">>): Promise<ReviewComment> {
    return request<ReviewComment>(`/review-comments/${commentId}`, { method: "PATCH", body: JSON.stringify(updates) });
  },
  async deleteReviewComment(commentId: string): Promise<void> {
    await request(`/review-comments/${commentId}`, { method: "DELETE" });
  },
  async suggestReviewResponse(commentId: string): Promise<string> {
    const res = await request<{ suggestion: string }>(`/review-comments/${commentId}/suggest`, { method: "POST" });
    return res.suggestion;
  },
  async downloadResponseLetter(draftId: string): Promise<void> {
    await downloadFile(`/drafts/${draftId}/response-letter`);
  },

  // Figures
  async getFigures(projectId: string): Promise<Figure[]> {
    return request<Figure[]>(`/projects/${projectId}/figures`);
  },
  async getFigure(figureId: string): Promise<Figure> {
    return request<Figure>(`/figures/${figureId}`);
  },
  async createFigure(datasetId: string, spec: FigureSpec & { caption?: string }): Promise<Figure> {
    return request<Figure>(`/datasets/${datasetId}/figures`, { method: "POST", body: JSON.stringify(spec) });
  },
  async updateFigure(figureId: string, updates: Partial<FigureSpec> & { caption?: string }): Promise<Figure> {
    return request<Figure>(`/figures/${figureId}`, { method: "PATCH", body: JSON.stringify(updates) });
  },
  async deleteFigure(figureId: string): Promise<void> {
    await request(`/figures/${figureId}`, { method: "DELETE" });
  },
  async replaceDatasetFile(datasetId: string, file: File): Promise<{ row_count?: number; figures_updated: number; figure_errors: string[] }> {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/v1/datasets/${datasetId}/replace`, { method: "POST", body: formData, credentials: "include" });
    if (!response.ok) throw new Error(await errorDetail(response, "Failed to replace dataset"));
    return response.json();
  },
};

async function errorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return body.detail || fallback;
  } catch {
    return fallback;
  }
}

/** Fetches a file endpoint and saves it using the filename the server sends. */
async function downloadFile(endpoint: string, options: RequestInit = {}): Promise<void> {
  const response = await fetch(`/api/v1${endpoint}`, { ...options, credentials: "include" });
  if (!response.ok) throw new Error(await errorDetail(response, "Download failed"));
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
  const filename = match ? decodeURIComponent(match[1]) : "download";
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
