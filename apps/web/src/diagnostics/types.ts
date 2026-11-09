export interface Projection {
  status: "disabled" | "pending" | "current" | "degraded";
  checkpoint_revision: { seq_no: number; primary_term: number } | null;
  indexed_revision: { seq_no: number; primary_term: number } | null;
  watermark_version: number | null;
  projected_at: string | null;
  last_error: string | null;
}
export interface IncidentDiagnostics {
  incident_id: string;
  version: number;
  storage: { mode: "memory" | "elasticsearch"; durable: boolean };
  provenance: { origin: "unknown" };
  verification: {
    status: string;
    reason: string;
    required_duration_s: number | null;
    observed_duration_s: number | null;
    evidence_signal_ids: string[];
  };
  signals: {
    signal_id: string;
    kind: string;
    source_id: string;
    observed_at: string;
    received_at: string | null;
    origin: "unknown";
    facts?: { zone: string; count: number; threshold: number };
  }[];
  events: {
    event_id: string;
    sequence: number;
    type: string;
    occurred_at: string;
    signal_ids: string[];
  }[];
  projection: Projection;
  trace: { trace_id: string | null; url: string | null };
}
export interface EvidenceHit {
  document_id: string;
  kind: "event";
  incident_id: string;
  room_id: string;
  event_type: string | null;
  occurred_at: string;
  received_at: string | null;
  summary: string;
  signal_id: string | null;
  event_id: string | null;
  sequence: number | null;
  trace_id: string | null;
}
export interface EvidencePage {
  items: EvidenceHit[];
  total: number;
  limit: number;
  projection: Projection;
}
export interface EvidenceQuery {
  q?: string;
  room_id?: string;
  event_type?: string;
  from?: string;
  to?: string;
  limit?: number;
}
