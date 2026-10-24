export type ResourceType = "paper" | "dataset" | "draft" | "folder";

export interface Project {
  id: string;
  name: string;
  description?: string;
  created_at: string;
  updated_at: string;
  paper_count?: number;
  dataset_count?: number;
  draft_count?: number;
}

export interface PaperSection {
  id: string;
  section_title: string;
  section_index: number;
  start_page?: number;
  end_page?: number;
  content: string;
}

export interface Paper {
  id: string;
  project_id: string;
  title: string;
  authors: Array<{ name: string; affiliation?: string }>;
  year?: number;
  abstract?: string;
  doi?: string;
  arxiv_id?: string;
  s3_key: string;
  file_size_bytes?: number;
  page_count?: number;
  parsing_status: "pending" | "processing" | "completed" | "failed";
  sections?: PaperSection[];
  created_at: string;
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  file_type: "csv" | "parquet" | "tsv";
  s3_key: string;
  file_size_bytes?: number;
  row_count?: number;
  column_count?: number;
  column_info?: Array<{ name: string; type: string; sample_values?: any[] }>;
  summary_stats?: Record<string, any>;
  created_at: string;
}

export interface Draft {
  id: string;
  project_id: string;
  title: string;
  content_type: "markdown" | "latex" | "python" | "typst";
  content: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TabItem {
  id: string; // unique tab instance ID
  resourceId: string;
  title: string;
  type: "paper" | "dataset" | "draft";
  pane: "left" | "right"; // for split view support
  metadata?: {
    page?: number;
    sectionTitle?: string;
    contentType?: string;
  };
}

export interface CitationItem {
  paper_id?: string;
  paper_title: string;
  section?: string;
  page?: number;
  snippet: string;
  score?: number;
  data_source?: "library" | "data";
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: CitationItem[];
  tool_calls?: any[];
  created_at: string;
}

export interface ChatSession {
  id: string;
  project_id: string;
  title: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface SearchResultItem {
  id: string;
  resource_type: "paper" | "dataset" | "draft";
  title: string;
  snippet: string;
  score: number;
  metadata: Record<string, any>;
}

export interface FileTreeItem {
  id: string;
  name: string;
  type: "folder" | "paper" | "dataset" | "draft";
  path: string;
  displayName?: string;
  status?: string;
  size?: number;
  children?: FileTreeItem[];
  [key: string]: any;
}
