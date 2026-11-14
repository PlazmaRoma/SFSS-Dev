import type { Source } from "@sfss/types";

export interface PredictResult {
  predicted_value: number | null;
  risk_score: number;
  target: string | null;
  defaults_applied: string[];
  warnings: string[];
  is_heuristic: boolean;
  chart_data: { x: number[]; y: number[] };
}

export interface BatchRowResult {
  row: number;
  predicted_value: number | null;
  warnings: string[];
  error: string | null;
}

export interface BatchResult {
  total: number;
  failed: number;
  is_heuristic: boolean;
  rows: BatchRowResult[];
}

export interface HealthInfo {
  status: string;
  chroma: boolean;
  lm_studio: boolean;
  runtime_name?: string;
  runtime_address?: string | null;
  model: string;
  indexed_documents: number | null;
  model_loaded: boolean | null;
  model_context_length: number | null;
  model_context_limit?: number | null;
  model_loading?: boolean;
}

export interface LoadResult {
  model: string;
  model_loaded: boolean | null;
  model_context_length: number | null;
}

/** Сервис сдаётся через 180 с, клиент ждёт чуть дольше, чтобы услышать причину. */
export const LOAD_TIMEOUT_MS = 200_000;

export interface DocumentInfo {
  doc_id: string;
  filename: string;
  chunks: number;
  size_bytes: number;
}

export interface ExperimentPoint {
  test: string;
  fuel: string;
  oxygen_level: number | null;
  pressure_mmhg: number | null;
  d_initial_mm: number | null;
  burn_rate_mm2s: number | null;
  d_extinction_mm: number | null;
  test_end: string | null;
}

export interface DashboardInfo {
  model: {
    target: string;
    units: string | null;
    target_range: [number, number] | null;
    metrics: Record<string, number>;
    feature_importance: Record<string, number>;
    is_heuristic: boolean;
    trained: boolean;
  };
  dataset: { name: string; source: string; rows: number; experiments: ExperimentPoint[] };
  corpus: { chunks: number; documents: string[]; embedding_model: string };
}

export interface ChatMessage {
  id: string;
  role: "user" | "ai";
  text: string;
  sources?: Source[];
  stage?: "loading" | "searching" | "answering" | "translating" | null;
  error?: string | null;
}

export interface Chat {
  id: string;
  title: string;
  messages: ChatMessage[];
}

export type Line =
  | { id: number; kind: "in" | "out" | "err"; text: string }
  | { id: number; kind: "req"; text: string; curl: string };
