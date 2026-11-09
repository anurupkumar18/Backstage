export type IncidentType = "overflow" | "stage_av" | "badge_stall" | "reported_problem";
export type Priority = "normal" | "high";
export type IncidentState =
  | "detected"
  | "triaged"
  | "plan_proposed"
  | "approved"
  | "dispatched"
  | "accepted"
  | "verifying"
  | "resolved"
  | "escalated";
export type AllowedAction = "approve" | "ack" | "handoff";
export type Domain = "venue" | "av" | "it";

export interface Plan {
  id: string;
  summary: string;
}

export interface Assignment {
  id: string;
  assignee_id: string;
  domain: Domain;
}

export interface Verification {
  status: "pending" | "passed" | "failed";
  summary: string | null;
}

export interface Incident {
  id: string;
  type: IncidentType;
  room_id: string;
  session_id: string | null;
  priority: Priority;
  state: IncidentState;
  version: number;
  updated_at: string;
  summary: string;
  plan: Plan | null;
  assignment: Assignment | null;
  verification: Verification;
  allowed_actions: AllowedAction[];
  trace_id: string | null;
}

export interface IncidentsPage {
  items: Incident[];
  next_cursor: string | null;
}

export type EventType =
  | "raise"
  | "claim"
  | "propose"
  | "approve"
  | "dispatch"
  | "ack"
  | "handoff"
  | "verify"
  | "close"
  | "escalate";

export interface ProtocolEvent {
  schema_version: 1;
  event_id: string;
  incident_id: string;
  sequence: number;
  type: EventType;
  occurred_at: string;
  actor: { id: string; kind: "human" | "agent" | "system"; tier: 0 | 1 | 2 | 3 | null };
  state_from: IncidentState | null;
  state_to: IncidentState;
  payload: Record<string, unknown>;
  trace_id: string | null;
}

export interface EventsPage {
  items: ProtocolEvent[];
  next_cursor: string | null;
}

export type PublicRoomStatus = "normal" | "affected" | "recovering";

export interface PublicStatus {
  rooms: {
    room_id: string;
    label: string;
    status: PublicRoomStatus;
    accessibility_status: string | null;
  }[];
  sessions: {
    session_id: string;
    room_id: string;
    label: string;
    status: PublicRoomStatus;
    accessibility_status: string | null;
  }[];
}

export const PRESENCE_TIERS = ["attendee", "speaker", "staff", "organizer"] as const;
export type PresenceTier = (typeof PRESENCE_TIERS)[number];

/**
 * Anonymous people counts per permission tier. Not in the v1 contract yet: mock mode only until the API
 * publishes an additive field. Counts only, never names or identities.
 */
export type PresenceCounts = Record<PresenceTier, number>;

export type Action =
  | { action: "approve"; expected_version: number; payload: { plan_id: string } }
  | {
      action: "ack";
      expected_version: number;
      payload: { assignment_id: string; decision: "accepted" | "declined" };
    }
  | { action: "handoff"; expected_version: number; payload: { assignment_id: string; reason: string } };

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "stale_version"
  | "invalid_transition"
  | "reservation_conflict"
  | "idempotency_conflict"
  | "invalid_payload"
  | "evidence_unavailable"
  | "unavailable"
  | "network";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code: ApiErrorCode; message: string };
