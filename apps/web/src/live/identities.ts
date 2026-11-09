import type { DemoIdentity } from "../mock/transport";

/**
 * Live-mode identities for a rehearsal against the real incident API. The tokens are Luke's local demo
 * tokens from services/incident-api/.env.example and only exist on a local or demo API. They are
 * prefilled only when VITE_PREFILL_DEMO_TOKENS=true. For any shared environment, enter real tokens at runtime.
 */
export const LIVE_IDENTITIES: DemoIdentity[] = [
  {
    id: "organizer",
    label: "Organizer",
    tier: 3,
    description: "Tier 3. Sees every incident and approves plans.",
    token: "demo-organizer",
  },
  {
    id: "venue-staff",
    label: "Venue staff",
    tier: 2,
    description: "Tier 2, venue domain. Accepts the first venue assignment.",
    token: "demo-staff",
  },
  {
    id: "venue-backup",
    label: "Venue staff (backup)",
    tier: 2,
    description: "Tier 2, venue domain. Takes over if the first assignee is stuck.",
    token: "demo-backup",
  },
  {
    id: "it-staff",
    label: "IT staff",
    tier: 2,
    description: "Tier 2, IT domain. Accepts badge-station incidents.",
    token: "demo-it-staff",
  },
  {
    id: "it-backup",
    label: "IT staff (backup)",
    tier: 2,
    description: "Tier 2, IT domain. Replacement for the first IT assignee.",
    token: "demo-it-backup",
  },
  {
    id: "speaker",
    label: "Speaker",
    tier: 1,
    description: "Tier 1. Sees incidents for its own session only.",
    token: "demo-session",
  },
  {
    id: "attendee",
    label: "Attendee",
    tier: 0,
    description: "Tier 0. Reads sanitized status only.",
    token: "demo-attendee",
  },
];
