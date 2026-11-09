import type { EventType, Incident, IncidentState, IncidentType, PublicRoomStatus } from "../api/types";
import { venueRoomLabel } from "../venue/kubecon-na-2026";

export const STEPS: IncidentState[] = [
  "detected",
  "triaged",
  "plan_proposed",
  "approved",
  "dispatched",
  "accepted",
  "verifying",
  "resolved",
];

export const STATE_LABEL: Record<IncidentState, string> = {
  detected: "Detected",
  triaged: "Triaged",
  plan_proposed: "Plan proposed",
  approved: "Approved",
  dispatched: "Dispatched",
  accepted: "Accepted",
  verifying: "Verifying",
  resolved: "Resolved",
  escalated: "Escalated",
};

export const TYPE_LABEL: Record<IncidentType, string> = {
  overflow: "Overflow",
  stage_av: "Stage AV",
  badge_stall: "Badge stall",
  reported_problem: "Reported problem",
};

export const EVENT_LABEL: Record<EventType, string> = {
  raise: "Raised",
  claim: "Claimed",
  propose: "Plan proposed",
  approve: "Approved",
  dispatch: "Dispatched",
  ack: "Acknowledged",
  handoff: "Handed off",
  verify: "Verification update",
  close: "Closed",
  escalate: "Escalated",
};

export const ROOM_STATUS_LABEL: Record<PublicRoomStatus, string> = {
  normal: "Normal",
  affected: "Affected",
  recovering: "Recovering",
};

export const DOMAIN_LABEL = { venue: "Venue", av: "AV", it: "IT" } as const;

export function roomLabel(roomId: string): string {
  const derived = roomId
    .split("-")
    .map((part) => (part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
  return venueRoomLabel(roomId, derived);
}

export const PHASES = ["Detect", "Plan", "Dispatch", "Verify"] as const;

/** Maps the nine real states onto the four-step bar. Escalated sits outside the bar. */
export function phaseIndex(state: IncidentState): number {
  switch (state) {
    case "detected":
    case "triaged":
      return 0;
    case "plan_proposed":
    case "approved":
      return 1;
    case "dispatched":
    case "accepted":
      return 2;
    case "verifying":
    case "resolved":
      return 3;
    case "escalated":
      return -1;
  }
}

export type Tone = "alert" | "info" | "ok";

export function toneFor(incident: Incident): Tone {
  if (incident.state === "escalated" || needsAction(incident)) return "alert";
  if (incident.state === "resolved") return "ok";
  return "info";
}

/** Turns an unknown wire value such as "door_jam" into "Door jam" so new API values never render as undefined. */
export function humanize(raw: string): string {
  const words = raw.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : raw;
}

export function stateLabel(state: string): string {
  return STATE_LABEL[state as IncidentState] ?? humanize(state);
}

export function typeLabel(type: string): string {
  return TYPE_LABEL[type as IncidentType] ?? humanize(type);
}

export function eventLabel(type: string): string {
  return EVENT_LABEL[type as EventType] ?? humanize(type);
}

export function domainLabel(domain: string): string {
  return (DOMAIN_LABEL as Record<string, string>)[domain] ?? humanize(domain);
}

export function priorityLabel(priority: string): string {
  if (priority === "high") return "High priority";
  if (priority === "normal") return "Normal priority";
  return `${humanize(priority)} priority`;
}

/** Plain-text verification status. Verifying always reads as waiting for evidence; resolved reads as Verified. */
export function verificationTitle(incident: Incident): string {
  const { verification, state } = incident;
  if (state === "resolved" || verification.status === "passed") return "Verified";
  if (verification.status === "failed") return "Verification failed";
  if (state === "verifying") return "Verifying: waiting for evidence";
  return "Not verified yet";
}

/**
 * The API emits microsecond precision (".123456Z" or ".123456+00:00"). Some engines reject more than three
 * fractional digits, so trim to milliseconds before parsing.
 */
export function parseIso(iso: string): Date {
  return new Date(iso.replace(/(\.\d{3})\d+/, "$1"));
}

const absolute = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export function formatAbsolute(iso: string): string {
  const date = parseIso(iso);
  return Number.isNaN(date.getTime()) ? iso : absolute.format(date);
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = parseIso(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds} s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function stateHint(incident: Incident): string {
  switch (incident.state) {
    case "detected":
    case "triaged":
      return "Agents are working out a plan.";
    case "plan_proposed":
      return "Waiting for an organizer to approve the plan.";
    case "approved":
      return "Approved. Finding someone to take it.";
    case "dispatched":
      return "Waiting for the assignee to acknowledge.";
    case "accepted":
      return "The assignee is on it. Verification starts next.";
    case "verifying":
      return "Fix applied. Waiting for evidence that it worked.";
    case "resolved":
      return "Closed after verified recovery.";
    case "escalated":
      return "Escalated. A person needs to take over.";
  }
}

export function needsAction(incident: Incident): boolean {
  return incident.allowed_actions.includes("approve") || incident.allowed_actions.includes("ack");
}
