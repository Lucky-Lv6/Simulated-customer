export interface CustomerProfile {
  id: string;
  name: string;
  company: string;
  position: string;
  industry: string;
  personality: string;
  technical_level: string;
  pain_points: string[];
  concerns: string[];
  avatar_emoji: string;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  feishu_products: string[];
  doubao_products: string[];
  tags: string[];
}

export interface Voice {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

export interface TranscriptMessage {
  role: 'user' | 'customer';
  text: string;
  isPartial: boolean;
}

export interface LatencyData {
  vad_ms: number;
  stt_ms: number;
  llm_first_token_ms: number;
  tts_first_audio_ms: number;
  total_ttfa_ms: number;
  above_sla: boolean;
}

export type CustomerStatusType = 'idle' | 'listening' | 'thinking' | 'speaking' | 'idle_timeout';

export interface EvaluationDimension {
  name: string;
  score: number;
  comment: string;
}

export interface EvaluationReport {
  total_score: number;
  dimensions: EvaluationDimension[];
  strengths: string[];
  weaknesses: string[];
  summary: string;
}

export interface ConversationStats {
  session_id: string;
  duration_seconds: number;
  total_turns: number;
  total_latency_records: number;
  avg_ttfa_ms: number;
  min_ttfa_ms: number;
  max_ttfa_ms: number;
  p50_ttfa_ms: number;
  p90_ttfa_ms: number;
  p95_ttfa_ms: number;
  p99_ttfa_ms: number;
  above_sla_count: number;
  sla_compliance_pct: number;
}

export interface LatencyHistoryItem {
  timestamp: number;
  vad_ms: number;
  stt_ms: number;
  llm_first_token_ms: number;
  tts_first_audio_ms: number;
  total_ttfa_ms: number;
  above_sla: boolean;
}

export interface LatencyStats {
  avg_ttfa_ms: number;
  min_ttfa_ms: number;
  max_ttfa_ms: number;
  p50_ttfa_ms: number;
  p95_ttfa_ms: number;
  p99_ttfa_ms: number;
  sla_compliance_pct: number;
  above_sla_count: number;
  total_records: number;
}

export interface HistoryItem {
  session_id: string;
  customer_name: string;
  scenario_name: string;
  difficulty: number;
  duration_seconds: number;
  total_turns: number;
  total_score: number;
  avg_ttfa_ms: number;
  sla_compliance_pct?: number;
  created_at?: string | null;
  evaluation?: EvaluationReport;
  transcripts?: TranscriptMessage[];
}

export interface UploadResult {
  filename: string;
  material_id?: string;
  parsed: boolean;
  is_script?: boolean;
  script_lines?: ScriptLine[];
  text: string;
  scenario: {
    company_background: string;
    industry: string;
    company_size: string;
    pain_points: string[];
    goals: string[];
    concerns: string[];
    requirements: string[];
    known_facts: string[];
  };
}

export interface ScriptLine {
  index: number;
  fde: string;
  customer: string;
}

export type WSMessage =
  | { type: 'session_id'; session_id: string }
  | { type: 'status'; status: CustomerStatusType; message?: string }
  | { type: 'transcript'; role: 'user' | 'customer'; text: string; is_partial?: boolean }
  | { type: 'latency'; data: LatencyData }
  | { type: 'error'; message: string }
  | { type: 'conversation_end'; stats: ConversationStats; evaluation: EvaluationReport };
