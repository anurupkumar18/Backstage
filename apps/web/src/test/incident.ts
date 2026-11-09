import type { Incident } from "../api/types";

export function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: "opaque-live-id-123", type: "overflow", room_id: "room-b", session_id: null,
    priority: "high", state: "plan_proposed", version: 3, updated_at: "2026-11-09T19:00:30.123456Z",
    summary: "Room B overflow", plan: { id: "plan-1", summary: "Hold entry and send venue staff." },
    assignment: null, verification: { status: "pending", summary: null }, allowed_actions: ["approve"], trace_id: null,
    ...overrides,
  };
}

