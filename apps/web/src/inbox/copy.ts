import type { Incident } from "../api/types";
import { roomLabel, stateLabel } from "../ui/format";

const TOPIC = { overflow: "crowding", stage_av: "stage audio or captions", badge_stall: "badge printing", reported_problem: "a reported problem" };

export function inboxTitle(incident: Incident): string {
  return `${roomLabel(incident.room_id)}: ${TOPIC[incident.type] ?? "an incident"}`;
}

export function inboxVerification(incident: Incident): string {
  if (incident.state === "resolved" && incident.verification.status === "passed") return "Verified";
  if (incident.verification.status === "failed") return "Verification failed: more evidence is needed";
  if (incident.state === "verifying" || incident.state === "accepted" || incident.state === "resolved") return "Verifying: waiting for evidence";
  return "Waiting for evidence";
}

export function inboxStatus(incident: Incident): string {
  if (incident.state === "accepted") return "Accepted: staff are on it";
  return stateLabel(incident.state);
}
