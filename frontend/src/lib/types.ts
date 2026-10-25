export type ResourceType = "paper" | "dataset" | "draft" | "figure" | "matrix" | "folder";

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

export interface BibEntry {
  paper_id: string;
  key: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  arxiv_id?: string;
  short: string; // in-text form, e.g. "Vaswani et al., 2017"
  formatted: string; // reference list entry
  bibtex: string;
}

export interface FigureSpec {
  chart: "line" | "bar" | "scatter" | "histogram";
  x: string;
  y: string[];
  title?: string;
  xlabel?: string;
  ylabel?: string;
}

export interface Figure {
  id: string;
  project_id: string;
  dataset_id?: string;
  dataset_name?: string;
  label: string;
  caption: string;
  spec: FigureSpec;
  version: number;
  render_error?: string;
  image_url: string;
  created_at: string;
  updated_at: string;
}

export interface DraftVersion {
  id: string;
  draft_id: string;
  version: number;
  label?: string;
  word_count: number;
  created_at: string;
  content?: string;
}

export type ReviewStatus = "open" | "addressed" | "declined";

export interface ReviewComment {
  id: string;
  draft_id: string;
  reviewer: string;
  body: string;
  anchor_text?: string;
  status: ReviewStatus;
  response: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface ExportTemplate {
  id: string;
  name: string;
  description: string;
}

export type ProblemKind =
  | "unknown_citation" | "missing_figure" | "close_paraphrase" | "data_mismatch"
  | "misattributed" | "unsupported" | "overstated" | "uncited" | "open_review";

export interface ProblemSource {
  paper_id: string;
  paper_title?: string;
  key?: string;
  page?: number;
  section?: string;
  snippet?: string;
}

export interface Problem {
  id: string;
  kind: ProblemKind;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  excerpt: string; // sentence (or token) in the draft the problem refers to
  match?: string | null; // exact text to underline inside the excerpt
  source?: ProblemSource | null;
  fix?: { label: string; find: string; replace: string } | null;
  dataset?: { id: string; name: string; row: string; column: string; value: string };
}

export interface ProblemsResponse {
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    sentences: number;
    audit: {
      ran: boolean;
      stale?: boolean;
      audited_at?: string;
      claims?: number;
      supported?: number;
      misattributed?: number;
      unsupported?: number;
      uncited?: number;
      partial?: number;
    };
  };
  problems: Problem[];
}

export interface MatrixColumn {
  name: string;
  question: string;
  type: "text" | "number" | "yes_no";
}

export interface MatrixCellValue {
  value: string | null;
  evidence?: { page?: number; section?: string; snippet?: string } | null;
  edited?: boolean;
}

export interface MatrixRow {
  paper_id: string;
  title: string;
  key?: string;
  short?: string;
  year?: number;
  status: string;
  cells: Record<string, MatrixCellValue>;
}

export interface LiteratureMatrix {
  id: string;
  project_id: string;
  name: string;
  columns: MatrixColumn[];
  status: "idle" | "filling" | "error";
  progress: { done?: number; total?: number; message?: string };
  dataset_id?: string | null;
  rows: MatrixRow[];
  updated_at?: string;
}

/** Text to insert into a draft, in both supported source formats. */
export interface DraftSnippet {
  markdown: string;
  latex: string;
}

export interface TabItem {
  id: string; // unique tab instance ID
  resourceId: string;
  title: string;
  type: "paper" | "dataset" | "draft" | "figure" | "matrix";
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
  type: "folder" | "paper" | "dataset" | "draft" | "figure" | "matrix";
  path: string;
  displayName?: string;
  status?: string;
  size?: number;
  children?: FileTreeItem[];
  [key: string]: any;
}
