import { Project, Paper, Dataset, Draft, ChatSession, ChatMessage, SearchResultItem, FileTreeItem } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

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

    const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/papers/upload`, {
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
    return `${API_BASE}/api/v1/papers/${paperId}/pdf`;
  },

  // Datasets
  async uploadDataset(projectId: string, file: File): Promise<Dataset> {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`${API_BASE}/api/v1/projects/${projectId}/datasets/upload`, {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!response.ok) throw new Error("Failed to upload dataset");
    return response.json();
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

  // Global Search
  async searchProject(projectId: string, query: string): Promise<{ query: string; results: SearchResultItem[] }> {
    return request(`/projects/${projectId}/search?q=${encodeURIComponent(query)}`);
  },
};
