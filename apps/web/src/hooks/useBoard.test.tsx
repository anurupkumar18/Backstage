import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createClient } from "../api/client";
import type { Incident, EventsPage } from "../api/types";
import { useBoard } from "./useBoard";
const silent = () => {};
const incident: Incident = {
  id: "inc-1",
  type: "overflow",
  room_id: "room-b",
  session_id: null,
  priority: "normal",
  state: "verifying",
  version: 3,
  updated_at: "2026-11-09T19:00:00Z",
  summary: "Overflow",
  plan: null,
  assignment: null,
  verification: { status: "pending", summary: null },
  allowed_actions: [],
  trace_id: null,
};
function setup(events: () => Promise<{ status: number; json: unknown }>) {
  return createClient({
    getToken: () => "",
    transport: async ({ path }) =>
      path.endsWith("/events")
        ? events()
        : { status: 200, json: { items: [incident], next_cursor: null } },
  });
}
describe("board evidence cache", () => {
  it("cancels an in-flight timeline without an unhandled rejection", async () => {
    const client = createClient({
      getToken: () => "",
      transport: async ({ path, signal }) => {
        if (!path.endsWith("/events"))
          return {
            status: 200,
            json: { items: [incident], next_cursor: null },
          };
        return new Promise((_resolve, reject) =>
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        );
      },
    });
    const { result, unmount } = renderHook(() =>
      useBoard({ client, pollMs: 100000, announce: silent }),
    );
    await waitFor(() => expect(result.current.incidents).toHaveLength(1));
    act(() => result.current.onTimelineOpen("inc-1"));
    const controller = new AbortController();
    await act(async () => {
      const pending = result.current.refresh(controller.signal);
      await pending;
      controller.abort();
    });
    unmount();
  });

  it("retries failed timeline at the same incident version on refresh", async () => {
    let calls = 0;
    const client = setup(async () =>
      ++calls === 1
        ? { status: 503, json: { error: { message: "Timeline offline" } } }
        : { status: 200, json: { items: [], next_cursor: null } },
    );
    const { result } = renderHook(() =>
      useBoard({ client, pollMs: 100000, announce: silent }),
    );
    await waitFor(() => expect(result.current.incidents).toHaveLength(1));
    act(() => result.current.onTimelineOpen("inc-1"));
    await waitFor(() => expect(calls).toBe(1));
    await act(() => result.current.refresh());
    await waitFor(() => expect(result.current.eventsById["inc-1"]).toEqual([]));
    expect(calls).toBe(2);
  });
  it("clears credential-generation caches and discards late old timeline responses", async () => {
    let resolve!: (value: { status: number; json: EventsPage }) => void;
    const oldClient = setup(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const newClient = createClient({
      getToken: () => "",
      transport: async () => ({
        status: 403,
        json: { error: { message: "Denied" } },
      }),
    });
    const announce = vi.fn();
    const { result, rerender } = renderHook(
      ({ client }) => useBoard({ client, pollMs: 100000, announce }),
      { initialProps: { client: oldClient } },
    );
    await waitFor(() => expect(result.current.incidents).toHaveLength(1));
    act(() => result.current.onTimelineOpen("inc-1"));
    rerender({ client: newClient });
    await waitFor(() =>
      expect(result.current.loadError?.message).toBe("Denied"),
    );
    await act(async () =>
      resolve({ status: 200, json: { items: [], next_cursor: null } }),
    );
    expect(result.current.incidents).toEqual([]);
    expect(result.current.eventsById).toEqual({});
  });
  it("discards an action response from a previous credential generation", async () => {
    const oldClient = setup(async () => ({
      status: 200,
      json: { items: [], next_cursor: null },
    }));
    const newClient = createClient({
      getToken: () => "",
      transport: async () => ({
        status: 403,
        json: { error: { message: "Denied" } },
      }),
    });
    const { result, rerender } = renderHook(
      ({ client }) => useBoard({ client, pollMs: 100000, announce: silent }),
      { initialProps: { client: oldClient } },
    );
    await waitFor(() => expect(result.current.incidents).toHaveLength(1));
    const staleApply = result.current.applyIncident;
    rerender({ client: newClient });
    await waitFor(() =>
      expect(result.current.loadError?.message).toBe("Denied"),
    );
    act(() => staleApply(incident));
    expect(result.current.incidents).toEqual([]);
  });
  it("does not let an older event response overwrite newer committed evidence", async () => {
    const resolves: ((value: { status: number; json: EventsPage }) => void)[] =
      [];
    const client = setup(() => new Promise((r) => resolves.push(r)));
    const { result } = renderHook(() =>
      useBoard({ client, pollMs: 100000, announce: silent }),
    );
    await waitFor(() => expect(result.current.incidents).toHaveLength(1));
    act(() => result.current.onTimelineOpen("inc-1"));
    act(() => result.current.onTimelineOpen("inc-1"));
    await act(async () =>
      resolves[1]!({ status: 200, json: { items: [], next_cursor: null } }),
    );
    await act(async () =>
      resolves[0]!({ status: 503, json: { items: [], next_cursor: null } }),
    );
    expect(result.current.eventsById["inc-1"]).toEqual([]);
    expect(result.current.eventErrorsById["inc-1"]).toBeUndefined();
  });
});
