import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "../api/client";
import type { Incident, ProtocolEvent } from "../api/types";
import { IncidentEvidence } from "./IncidentEvidence";
import type { IncidentDiagnostics } from "./types";
const incident: Incident = {
  id: "inc-1",
  type: "overflow",
  room_id: "room-b",
  session_id: null,
  priority: "normal",
  state: "verifying",
  version: 4,
  updated_at: "2026-11-09T19:00:30Z",
  summary: "Door crowded",
  plan: null,
  assignment: null,
  verification: { status: "pending", summary: null },
  allowed_actions: [],
  trace_id: "1234567890abcdef1234567890abcdef",
};
const event: ProtocolEvent = {
  schema_version: 1,
  event_id: "event-1",
  incident_id: "inc-1",
  sequence: 1,
  type: "raise",
  occurred_at: incident.updated_at,
  actor: { id: "api", kind: "system", tier: null },
  state_from: null,
  state_to: "detected",
  payload: { signal_id: "sig-1" },
  trace_id: incident.trace_id,
};
const projection = {
  status: "pending" as const,
  checkpoint_revision: { seq_no: 4, primary_term: 1 },
  indexed_revision: { seq_no: 3, primary_term: 1 },
  watermark_version: 3,
  projected_at: "2026-11-09T19:00:00Z",
  last_error: null,
};
const diagnostic: IncidentDiagnostics = {
  incident_id: "inc-1",
  version: 4,
  storage: { mode: "memory", durable: false },
  provenance: { origin: "unknown" },
  verification: {
    status: "pending",
    reason: "Door samples must stay fresh and below threshold.",
    required_duration_s: 60,
    observed_duration_s: 20,
    evidence_signal_ids: ["sig-1"],
  },
  signals: [
    {
      signal_id: "sig-1",
      kind: "zone_count",
      source_id: "cam-b",
      observed_at: incident.updated_at,
      received_at: incident.updated_at,
      origin: "unknown",
      facts: { zone: "door", count: 2, threshold: 5 },
    },
  ],
  events: [
    {
      event_id: "event-1",
      sequence: 1,
      type: "raise",
      occurred_at: event.occurred_at,
      signal_ids: ["sig-1"],
    },
  ],
  projection,
  trace: {
    trace_id: incident.trace_id,
    url: "https://app.dash0.com/traces/123",
  },
};
function client(
  override?: (path: string) => { status: number; json: unknown } | undefined,
) {
  return createClient({
    getToken: () => "",
    transport: async ({ path }) =>
      override?.(path) ?? {
        status: 200,
        json: path.endsWith("/events")
          ? { items: [event], next_cursor: null }
          : path.endsWith("/diagnostics")
            ? diagnostic
            : incident,
      },
  });
}
describe("Incident evidence inspector", () => {
  it("selects real committed events, shows references and explains the recovery wait without inventing progress", async () => {
    const user = userEvent.setup();
    render(
      <IncidentEvidence
        incident={incident}
        client={client()}
        mockMode={false}
      />,
    );
    const flow = await screen.findByRole("list", {
      name: "Committed event sequence",
    });
    await user.click(within(flow).getByRole("button", { name: /1.*raise/i }));
    expect(
      screen.getByRole("region", { name: "Selected event" }),
    ).toHaveTextContent("sig-1");
    expect(screen.getByText("20 of 60 seconds observed")).toBeInTheDocument();
    expect(
      screen.getByText("Memory checkpoint · not durable"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Origin unknown/)).toBeInTheDocument();
    expect(screen.getByText(/pending.*version 3/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open trace in Dash0" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(incident.trace_id!)).toBeInTheDocument();
    expect(
      screen.queryByText(/Provider ingestion is not verified/),
    ).not.toBeInTheDocument();
  });
  it("shows a timeline error and retries successfully without a version change", async () => {
    const user = userEvent.setup();
    let failed = true;
    render(
      <IncidentEvidence
        incident={incident}
        client={client((path) =>
          path.endsWith("/events") && failed
            ? {
                status: 503,
                json: { error: { message: "Timeline unavailable" } },
              }
            : undefined,
        )}
        mockMode={false}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Timeline unavailable",
    );
    failed = false;
    await user.click(screen.getByRole("button", { name: "Retry timeline" }));
    expect(
      await screen.findByRole("list", { name: "Committed event sequence" }),
    ).toHaveTextContent("raise");
  });
  it("keeps search errors distinct from successful empty results and opens the matching historical incident/event", async () => {
    const user = userEvent.setup();
    let mode = "error";
    const c = client((path) =>
      path.startsWith("/evidence/search")
        ? mode === "error"
          ? {
              status: 503,
              json: {
                error: {
                  code: "evidence_unavailable",
                  message: "Index unavailable",
                },
              },
            }
          : mode === "empty"
            ? {
                status: 200,
                json: { items: [], total: 0, limit: 20, projection },
              }
            : {
                status: 200,
                json: {
                  items: [
                    {
                      document_id: "d",
                      kind: "event",
                      incident_id: "historic",
                      room_id: "room-b",
                      event_type: "raise",
                      occurred_at: event.occurred_at,
                      received_at: null,
                      summary: "Prior overflow",
                      signal_id: null,
                      event_id: "event-1",
                      sequence: 1,
                      trace_id: null,
                    },
                  ],
                  total: 1,
                  limit: 20,
                  projection,
                },
              }
        : path === "/incidents/historic"
          ? {
              status: 200,
              json: { ...incident, id: "historic", summary: "Prior overflow" },
            }
          : undefined,
    );
    render(
      <IncidentEvidence incident={incident} client={c} mockMode={false} />,
    );
    await user.type(
      screen.getByRole("searchbox", { name: "Search committed evidence" }),
      "overflow",
    );
    await user.click(screen.getByRole("button", { name: "Search evidence" }));
    expect(await screen.findByText("Index unavailable")).toBeInTheDocument();
    expect(
      screen.queryByText("No committed evidence matches these filters."),
    ).toBeNull();
    mode = "empty";
    await user.click(screen.getByRole("button", { name: "Search evidence" }));
    expect(
      await screen.findByText("No committed evidence matches these filters."),
    ).toBeInTheDocument();
    mode = "hit";
    await user.click(screen.getByRole("button", { name: "Search evidence" }));
    await user.click(
      await screen.findByRole("button", { name: /Open Prior overflow/ }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Evidence for Prior overflow",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Evidence for Prior overflow" }),
    ).toHaveFocus();
    await waitFor(() =>
      expect(
        screen.getByRole("region", { name: "Selected event" }),
      ).toHaveTextContent("event-1"),
    );
  });
  it("does not retain evidence when credentials change", async () => {
    const c = client();
    const { rerender } = render(
      <IncidentEvidence incident={incident} client={c} mockMode={false} />,
    );
    await screen.findByRole("list", { name: "Committed event sequence" });
    let release!: (value: { status: number; json: unknown }) => void;
    const denied = createClient({
      getToken: () => "",
      transport: () =>
        new Promise((r) => {
          release = r;
        }),
    });
    rerender(
      <IncidentEvidence incident={incident} client={denied} mockMode={false} />,
    );
    expect(
      screen.queryByRole("list", { name: "Committed event sequence" }),
    ).toBeNull();
    expect(screen.queryByText("Memory checkpoint · not durable")).toBeNull();
  });
});

it("never substitutes a different event when a search reference is unavailable", async () => {
  const user = userEvent.setup();
  const c = client((path) =>
    path.startsWith("/evidence/search")
      ? {
          status: 200,
          json: {
            items: [
              {
                document_id: "missing",
                kind: "event",
                incident_id: "inc-1",
                room_id: "room-b",
                event_type: "close",
                occurred_at: event.occurred_at,
                received_at: null,
                summary: "Closure evidence",
                signal_id: null,
                event_id: "missing-event",
                sequence: 9,
                trace_id: null,
              },
            ],
            total: 1,
            limit: 20,
            projection,
          },
        }
      : undefined,
  );
  render(<IncidentEvidence incident={incident} client={c} mockMode={false} />);
  await user.click(screen.getByRole("button", { name: "Search evidence" }));
  await user.click(
    await screen.findByRole("button", { name: /Open Closure evidence/ }),
  );
  expect(
    await screen.findByText(
      "The selected event is unavailable in the committed timeline. Refresh the timeline to try again.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Selected event" })).toBeNull();
});
