export type Lang = "en" | "ru";

export interface PredictResponse {
  predicted_value: number;
  risk_score: number;
  target: string;
  defaults_applied: string[];
  is_heuristic: boolean;
}

export interface DashboardModel {
  name: string;
  units: string;
  target: string;
  target_range: [number, number];
  metrics: { r2: number; mae: number; rmse: number; mae_baseline: number; rows: number; folds: number };
  feature_importance: Record<string, number>;
  features: string[];
  defaults: Record<string, number>;
  is_heuristic: boolean;
  trained: boolean;
}

export interface Dashboard { model: DashboardModel }

export interface Health {
  status: string;
  chroma: boolean;
  lm_studio: boolean;
  model: string;
  indexed_documents: number | null;
}

export type RuntimeKind = "lmstudio" | "ollama";

export interface LlmConfig {
  runtime: {
    kind: RuntimeKind;
    name: string;
    host: string;
    port: number;
    controls_context: boolean;
    reachable: boolean;
  };
  model: { name: string; context_length: number; max_tokens: number; available: boolean | null };
  embedding_model: string;
}

export interface LlmPatch {
  runtime?: { kind?: RuntimeKind; host?: string; port?: number };
  model?: { name?: string; context_length?: number; max_tokens?: number };
}

export interface LlmModels {
  runtime: RuntimeKind;
  models: { id: string; loaded: boolean; max_context_length: number | null }[];
}

export interface Source { doc_id: string; page: number | null; excerpt: string }
export interface Answer { answer: string; sources: Source[] }
export interface CacheEntry { question: Record<Lang, string>; en: Answer; ru: Answer }

export interface Atmosphere {
  oxygen_level: number;
  pressure_psi: number;
  droplet_mm: number;
}

export interface BassExperiment {
  test: string; sample: string; pi: string;
  material: string; material_ru: string;
  shape: string; shape_ru: string;
  oxygen_pct: number | null;
  flow_initial_cms: number | null;
  flow_final_cms: number | null;
  outcome: string; outcome_ru: string;
}
