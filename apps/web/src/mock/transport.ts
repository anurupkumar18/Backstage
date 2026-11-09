import type { Transport } from "../api/transport";
import { MockIncidentApi, type Principal } from "./store";

export interface DemoIdentity {
  id: string;
  label: string;
  tier: 0 | 1 | 2 | 3;
  description: string;
  token: string;
}

/** Mock-mode identities. These tokens only exist in the in-browser mock and grant nothing on a real API. */
export const DEMO_IDENTITIES: DemoIdentity[] = [
  {
    id: "organizer",
    label: "Organizer",
    tier: 3,
    description: "Tier 3. Sees the board and approves plans.",
    token: "mock-organizer",
  },
  {
    id: "venue-staff",
    label: "Venue staff",
    tier: 2,
    description: "Tier 2. Acknowledges assignments in the venue domain.",
    token: "mock-venue-staff-01",
  },
  {
    id: "attendee",
    label: "Attendee",
    tier: 0,
    description: "Tier 0. Reads sanitized status only.",
    token: "mock-attendee",
  },
];

export const MOCK_PRINCIPALS: Record<string, Principal> = {
  "mock-organizer": { id: "organizer-01", tier: 3 },
  "mock-venue-staff-01": { id: "venue-staff-01", tier: 2 },
  "mock-attendee": { id: "attendee-01", tier: 0 },
};

export function createMockTransport(api: MockIncidentApi, latencyMs = 0): Transport {
  return async (request) => {
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs));
    }
    if (request.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const response = api.handle({
      method: request.method,
      path: request.path,
      headers: request.headers,
      body: request.body === undefined ? undefined : JSON.parse(JSON.stringify(request.body)),
    });
    return response;
  };
}
